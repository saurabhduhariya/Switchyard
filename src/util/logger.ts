import { redact } from './redact';

export interface OutputChannelLike {
  appendLine(value: string): void;
  show?(preserveFocus?: boolean): void;
  dispose?(): void;
}

export class Logger {
  constructor(
    private channel?: OutputChannelLike,
    private prefix: string = '[Switchyard]'
  ) {}

  info(...args: unknown[]): void {
    this.log('INFO', args);
  }

  warn(...args: unknown[]): void {
    this.log('WARN', args);
  }

  error(...args: unknown[]): void {
    this.log('ERROR', args);
  }

  debug(...args: unknown[]): void {
    this.log('DEBUG', args);
  }

  private log(level: string, args: unknown[]): void {
    const timestamp = new Date().toISOString();
    const formatted = args
      .map((arg) => {
        if (typeof arg === 'string') {
          return redact(arg);
        }
        if (arg instanceof Error) {
          return redact(arg.stack || arg.message);
        }
        try {
          return redact(JSON.stringify(arg));
        } catch {
          return String(arg);
        }
      })
      .join(' ');

    const line = `${timestamp} ${this.prefix} [${level}] ${formatted}`;

    if (this.channel) {
      this.channel.appendLine(line);
    } else {
      if (level === 'ERROR') {
        console.error(line);
      } else if (level === 'WARN') {
        console.warn(line);
      } else {
        console.log(line);
      }
    }
  }
}
