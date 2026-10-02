import * as child_process from 'node:child_process';
import * as net from 'node:net';
import { AccountQuotaSummary } from '../accounts/types';
import { readKeys } from '../db/StateDb';
import { Logger } from '../util/logger';

interface LSServerEndpoint {
  port: number;
  token: string;
}

interface ClientModelConfig {
  label?: string;
  modelName?: string;
  quotaInfo?: {
    remainingFraction?: number;
    resetTime?: string;
  };
}

interface GetUserStatusResponse {
  userStatus?: {
    userTier?: {
      name?: string;
      id?: string;
    };
    cascadeModelConfigData?: {
      clientModelConfigs?: ClientModelConfig[];
    };
  };
}

/**
 * Collects model usage and quota summaries.
 * Primary: Queries the local Antigravity Language Server via loopback net.Socket IPC.
 * Fallback: Reads and decodes state.vscdb protobuf payload.
 *
 * Strictly zero-telemetry, zero-external-network compliant.
 */
export class QuotaCollector {
  private cachedEndpoint?: LSServerEndpoint;

  constructor(private readonly logger?: Logger) {}

  /**
   * Retrieves the current account's model quota summary.
   */
  public async getQuotaSummary(dbPath?: string): Promise<AccountQuotaSummary | undefined> {
    try {
      const live = await this.queryLiveUserStatus();
      if (live?.userStatus) {
        return this.parseUserStatusResponse(live.userStatus, 'live');
      }
    } catch (err) {
      this.logger?.debug('Live quota query failed, trying database fallback:', err);
    }

    if (dbPath) {
      try {
        const fromDb = await this.loadFromDb(dbPath);
        if (fromDb) return fromDb;
      } catch (err) {
        this.logger?.debug('Database quota fallback failed:', err);
      }
    }

    return undefined;
  }

  /**
   * Queries user status directly from local language server via loopback net.Socket.
   */
  private async queryLiveUserStatus(): Promise<GetUserStatusResponse | undefined> {
    const endpoint = await this.getOrDiscoverEndpoint();
    if (!endpoint) return undefined;

    try {
      return await this.sendConnectRpc(endpoint.port, endpoint.token);
    } catch (err) {
      // Clear cache and retry discovery once
      this.cachedEndpoint = undefined;
      const retryEndpoint = await this.getOrDiscoverEndpoint();
      if (retryEndpoint) {
        return await this.sendConnectRpc(retryEndpoint.port, retryEndpoint.token);
      }
      throw err;
    }
  }

  /**
   * Sends Connect-RPC HTTP/1.1 POST /exa.language_server_pb.LanguageServerService/GetUserStatus
   * using raw net.Socket to avoid high-level HTTP client libraries.
   */
  private sendConnectRpc(port: number, token: string): Promise<GetUserStatusResponse> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
        const body = '{}';
        const req = [
          'POST /exa.language_server_pb.LanguageServerService/GetUserStatus HTTP/1.1',
          `Host: 127.0.0.1:${port}`,
          'Content-Type: application/json',
          'Accept: application/json',
          'Connect-Protocol-Version: 1',
          `x-codeium-csrf-token: ${token}`,
          `Content-Length: ${Buffer.byteLength(body)}`,
          'Connection: close',
          '',
          body,
        ].join('\r\n');
        socket.write(req);
      });

      let raw = '';
      socket.on('data', (chunk) => {
        raw += chunk.toString('utf8');
      });

      socket.on('end', () => {
        try {
          const res = this.parseHttpResponseBody<GetUserStatusResponse>(raw);
          resolve(res);
        } catch (e) {
          reject(e);
        }
      });

      socket.on('error', reject);
      socket.setTimeout(2500, () => {
        socket.destroy();
        reject(new Error('Language server IPC socket timeout'));
      });
    });
  }

  /**
   * Parses HTTP response body, handling Chunked Transfer Encoding if present.
   */
  private parseHttpResponseBody<T>(raw: string): T {
    const headerEndIdx = raw.indexOf('\r\n\r\n');
    if (headerEndIdx === -1) {
      throw new Error('Malformed HTTP response: no header terminator');
    }
    const headers = raw.slice(0, headerEndIdx);
    const body = raw.slice(headerEndIdx + 4);

    if (!headers.includes('200 OK')) {
      const statusLine = headers.split('\r\n')[0];
      throw new Error(`HTTP Error from LS: ${statusLine}`);
    }

    if (headers.toLowerCase().includes('transfer-encoding: chunked')) {
      let decoded = '';
      let remaining = body;
      while (remaining.length > 0) {
        const lineEnd = remaining.indexOf('\r\n');
        if (lineEnd === -1) break;
        const sizeHex = remaining.slice(0, lineEnd).trim();
        const size = parseInt(sizeHex, 16);
        if (isNaN(size) || size === 0) break;
        const chunk = remaining.slice(lineEnd + 2, lineEnd + 2 + size);
        decoded += chunk;
        remaining = remaining.slice(lineEnd + 2 + size + 2);
      }
      return JSON.parse(decoded) as T;
    }

    return JSON.parse(body) as T;
  }

  /**
   * Discovers the language server listening port and CSRF token.
   */
  private async getOrDiscoverEndpoint(): Promise<LSServerEndpoint | undefined> {
    if (this.cachedEndpoint) {
      return this.cachedEndpoint;
    }

    // Try finding running language_server process
    const endpoint = await this.discoverEndpoint();
    if (endpoint) {
      this.cachedEndpoint = endpoint;
      this.logger?.debug(`Discovered Language Server on port ${endpoint.port}`);
    }
    return endpoint;
  }

  private async discoverEndpoint(): Promise<LSServerEndpoint | undefined> {
    try {
      const isWin = process.platform === 'win32';
      const psCmd = isWin ? 'tasklist /v' : 'ps aux';
      const psOut = child_process.execSync(psCmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });

      const lines = psOut.split('\n');
      const lsLines = lines.filter((l) => l.includes('language_server') && l.includes('--csrf_token'));

      for (const line of lsLines) {
        const tokenMatch = line.match(/--csrf_token\s+([a-f0-9-]+)/);
        const pidMatch = line.trim().match(/^\S+\s+(\d+)/);
        if (!tokenMatch || !pidMatch) continue;

        const token = tokenMatch[1];
        const pid = pidMatch[1];

        // Find listening ports for this pid
        const ports = this.getListeningPortsForPid(pid);
        for (const port of ports) {
          try {
            const res = await this.sendConnectRpc(port, token);
            if (res && res.userStatus) {
              return { port, token };
            }
          } catch {
            // Port wasn't the HTTP service, continue trying
          }
        }
      }
    } catch (err) {
      this.logger?.debug('Process discovery error:', err);
    }
    return undefined;
  }

  private getListeningPortsForPid(pid: string): number[] {
    const ports: number[] = [];
    try {
      if (process.platform === 'linux') {
        const ssOut = child_process.execSync('ss -tlpn', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        const regex = new RegExp(`127\\.0\\.0\\.1:(\\d+).*?pid=${pid}\\b`, 'g');
        for (const match of ssOut.matchAll(regex)) {
          ports.push(parseInt(match[1], 10));
        }
      } else if (process.platform === 'darwin') {
        const lsofOut = child_process.execSync(`lsof -nP -p ${pid} -iTCP -sTCP:LISTEN`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        for (const match of lsofOut.matchAll(/127\.0\.0\.1:(\d+)/g)) {
          ports.push(parseInt(match[1], 10));
        }
      }
    } catch {}
    return ports;
  }

  /**
   * Transforms GetUserStatus into AccountQuotaSummary matching the UI requirements.
   */
  private parseUserStatusResponse(
    userStatus: NonNullable<GetUserStatusResponse['userStatus']>,
    source: 'live' | 'vscdb'
  ): AccountQuotaSummary {
    let tierName = userStatus.userTier?.name || 'Antigravity Quota';
    if (!tierName.toLowerCase().includes('quota')) {
      tierName = `${tierName} Quota`;
    }

    const configs = userStatus.cascadeModelConfigData?.clientModelConfigs || [];

    // Find Gemini config
    const geminiConfig = configs.find(
      (c) => c.label?.toLowerCase().includes('gemini') && c.quotaInfo?.remainingFraction !== undefined
    );

    // Find Claude / GPT config
    const claudeGptConfig = configs.find(
      (c) =>
        (c.label?.toLowerCase().includes('claude') || c.label?.toLowerCase().includes('gpt')) &&
        c.quotaInfo?.resetTime !== undefined
    );

    const geminiRemaining =
      geminiConfig?.quotaInfo?.remainingFraction !== undefined
        ? Math.round(geminiConfig.quotaInfo.remainingFraction * 10000) / 100
        : undefined;

    const claudeGptRemaining =
      claudeGptConfig?.quotaInfo?.remainingFraction !== undefined &&
      claudeGptConfig?.quotaInfo?.remainingFraction !== null
        ? Math.round(claudeGptConfig.quotaInfo.remainingFraction * 10000) / 100
        : 0;

    return {
      tierName,
      gemini: {
        name: 'Gemini',
        weeklyRemaining: geminiRemaining,
        weeklyResetTime: geminiConfig?.quotaInfo?.resetTime,
      },
      claudeGpt: {
        name: 'Claude + GPT',
        weeklyRemaining: claudeGptRemaining,
        weeklyResetTime: claudeGptConfig?.quotaInfo?.resetTime,
      },
      updatedAt: Date.now(),
      source,
    };
  }

  /**
   * Database fallback: Decodes antigravityUnifiedStateSync.userStatus from state.vscdb
   */
  private async loadFromDb(dbPath: string): Promise<AccountQuotaSummary | undefined> {
    const keys = readKeys(dbPath, ['antigravityUnifiedStateSync.userStatus']);
    const val = keys['antigravityUnifiedStateSync.userStatus'];
    if (!val) return undefined;

    try {
      const raw = Buffer.from(val, 'base64');
      // Look for inner base64 string after userStatusSentinelKey
      const match = raw.toString('binary').match(/userStatusSentinelKey.{1,10}?([A-Za-z0-9+/=]{100,})/);
      if (!match) return undefined;

      const inner = Buffer.from(match[1], 'base64');
      // Look for field 33 (cascadeModelConfigData)
      let offset = 0;
      let field33: Buffer | undefined;

      while (offset < inner.length) {
        const { fieldNum, wireType, nextOffset } = this.readVarintKey(inner, offset);
        offset = nextOffset;
        if (wireType === 2) {
          const { length, nextOffset: dataOffset } = this.readVarint(inner, offset);
          offset = dataOffset;
          const subdata = inner.subarray(offset, offset + length);
          offset += length;
          if (fieldNum === 33) {
            field33 = subdata;
            break;
          }
        } else if (wireType === 0) {
          const { nextOffset: no } = this.readVarint(inner, offset);
          offset = no;
        } else if (wireType === 1) {
          offset += 8;
        } else if (wireType === 5) {
          offset += 4;
        }
      }

      if (!field33) return undefined;

      // Parse models in field 33
      let geminiRemaining: number | undefined;
      let geminiResetTime: string | undefined;
      let claudeResetTime: string | undefined;

      let j = 0;
      while (j < field33.length) {
        const { fieldNum: fn, wireType: w, nextOffset: nxt } = this.readVarintKey(field33, j);
        j = nxt;
        if (w === 2) {
          const { length: l, nextOffset: dl } = this.readVarint(field33, j);
          j = dl;
          const cfg = field33.subarray(j, j + l);
          j += l;

          if (fn === 1) {
            const { label, fraction, resetSec } = this.parseModelConfigSubmessage(cfg);
            if (label && label.toLowerCase().includes('gemini') && fraction !== undefined && geminiRemaining === undefined) {
              geminiRemaining = Math.round(fraction * 10000) / 100;
              if (resetSec) {
                geminiResetTime = new Date(resetSec * 1000).toISOString();
              }
            } else if (label && (label.toLowerCase().includes('claude') || label.toLowerCase().includes('gpt')) && resetSec && !claudeResetTime) {
              claudeResetTime = new Date(resetSec * 1000).toISOString();
            }
          }
        } else if (w === 0) {
          const { nextOffset: no } = this.readVarint(field33, j);
          j = no;
        } else if (w === 1) j += 8;
        else if (w === 5) j += 4;
      }

      return {
        tierName: 'Antigravity Quota',
        gemini: {
          name: 'Gemini',
          weeklyRemaining: geminiRemaining ?? 100,
          weeklyResetTime: geminiResetTime,
        },
        claudeGpt: {
          name: 'Claude + GPT',
          weeklyRemaining: 0,
          weeklyResetTime: claudeResetTime,
        },
        updatedAt: Date.now(),
        source: 'vscdb',
      };
    } catch (e) {
      this.logger?.debug('Failed to decode protobuf userStatus:', e);
      return undefined;
    }
  }

  private readVarint(buf: Buffer, offset: number): { value: number; length: number; nextOffset: number } {
    let value = 0;
    let shift = 0;
    let i = offset;
    while (i < buf.length) {
      const b = buf[i++];
      value |= (b & 0x7f) << shift;
      shift += 7;
      if (!(b & 0x80)) break;
    }
    return { value, length: value, nextOffset: i };
  }

  private readVarintKey(buf: Buffer, offset: number): { fieldNum: number; wireType: number; nextOffset: number } {
    const { value: key, nextOffset } = this.readVarint(buf, offset);
    return { fieldNum: key >> 3, wireType: key & 0x7, nextOffset };
  }

  private parseModelConfigSubmessage(cfg: Buffer): { label?: string; fraction?: number; resetSec?: number } {
    let label: string | undefined;
    let fraction: number | undefined;
    let resetSec: number | undefined;

    let ci = 0;
    while (ci < cfg.length) {
      const { fieldNum: cfn, wireType: cw, nextOffset: cnxt } = this.readVarintKey(cfg, ci);
      ci = cnxt;
      if (cw === 2) {
        const { length: cl, nextOffset: cdl } = this.readVarint(cfg, ci);
        ci = cdl;
        const sub = cfg.subarray(ci, ci + cl);
        ci += cl;
        if (cfn === 1) {
          label = sub.toString('utf8');
        } else if (cfn === 15) {
          // quotaInfo
          let qi = 0;
          while (qi < sub.length) {
            const { wireType: qw, nextOffset: qnxt } = this.readVarintKey(sub, qi);
            qi = qnxt;
            if (qw === 5) {
              fraction = sub.readFloatLE(qi);
              qi += 4;
            } else if (qw === 2) {
              const { length: ql, nextOffset: qdl } = this.readVarint(sub, qi);
              qi = qdl;
              const rsub = sub.subarray(qi, qi + ql);
              qi += ql;
              if (rsub.length >= 2 && rsub[0] >> 3 === 1) {
                const { value: sec } = this.readVarint(rsub, 1);
                resetSec = sec;
              }
            } else if (qw === 0) {
              const { nextOffset: qno } = this.readVarint(sub, qi);
              qi = qno;
            } else if (qw === 1) qi += 8;
          }
        }
      } else if (cw === 0) {
        const { nextOffset: cno } = this.readVarint(cfg, ci);
        ci = cno;
      } else if (cw === 1) ci += 8;
      else if (cw === 5) ci += 4;
    }

    return { label, fraction, resetSec };
  }
}
