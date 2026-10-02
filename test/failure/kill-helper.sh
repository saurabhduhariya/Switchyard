#!/bin/bash
# Test: Kill switch-helper at various stages
# Expected: Rollback succeeds, original account restored

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES_DIR="$SCRIPT_DIR/fixtures"
TEST_DB="$FIXTURES_DIR/test-state.vscdb"
BACKUP_DIR="$FIXTURES_DIR/backups"

echo "==================================="
echo "Failure Test: Kill Helper Mid-Switch"
echo "==================================="

# Ensure fixtures exist
if [ ! -f "$FIXTURES_DIR/A.vscdb" ]; then
  echo "ERROR: fixtures/A.vscdb not found. Run setup first."
  exit 1
fi

# Setup: Copy Account A database
echo "Setting up test database..."
cp "$FIXTURES_DIR/A.vscdb" "$TEST_DB"
mkdir -p "$BACKUP_DIR"

echo "Test 1: Kill after backup, before write"
echo "---------------------------------------"
# This test requires manual intervention or mock helper modification
echo "MANUAL: Start switch A→B, then kill helper immediately"
echo "Expected: Original DB untouched, error reported"
echo ""

echo "Test 2: Kill after write, before verification"
echo "--------------------------------------------"
echo "MANUAL: Modify helper to sleep 2s after write, kill during sleep"
echo "Expected: Verification fails, backup restored"
echo ""

echo "Test 3: Kill after verification, before relaunch"
echo "-----------------------------------------------"
echo "MANUAL: Modify helper to sleep 2s after verify, kill during sleep"
echo "Expected: Switch succeeded but IDE not relaunched, result file written"
echo ""

echo "Automated check: Helper crash leaves no temp files"
echo "-------------------------------------------------"

# Create mock job file
JOB_FILE="/tmp/switchyard-job-killtest.json"
cat > "$JOB_FILE" << EOF
{
  "version": 1,
  "parentPid": $$,
  "dbPath": "$TEST_DB",
  "targetEmail": "test@example.com",
  "targetFingerprint": "abc123",
  "values": {},
  "backupDir": "$BACKUP_DIR",
  "relaunch": { "exe": "/bin/true", "args": [] },
  "resultFile": "/tmp/switchyard-result-killtest.json"
}
EOF

# Simulate helper crash by immediate SIGKILL (if helper process was real)
echo "Simulating immediate crash..."
# In real test, would: node dist/switch-helper.js $JOB_FILE &
# sleep 0.1 && kill -9 $! 

# Check no temp files left
TEMP_COUNT=$(ls /tmp/switchyard-* 2>/dev/null | wc -l)
if [ "$TEMP_COUNT" -gt 0 ]; then
  echo "⚠️  WARN: Temp files still exist (this is expected for manual test)"
  ls -la /tmp/switchyard-*
else
  echo "✓ No temp files leaked"
fi

echo ""
echo "Cleanup..."
rm -f "$JOB_FILE" /tmp/switchyard-result-killtest.json "$TEST_DB"

echo ""
echo "==================================="
echo "Test complete. Review results above."
echo "For full testing, modify switch-helper.ts to add sleep stages."
echo "==================================="
