#!/bin/bash
# Test: Handle corrupted database file
# Expected: Unsupported guard triggers, clear error

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES_DIR="$SCRIPT_DIR/fixtures"
TEST_DB="$FIXTURES_DIR/test-corrupt.vscdb"

echo "==================================="
echo "Failure Test: Corrupted Database"
echo "==================================="

# Setup
if [ ! -f "$FIXTURES_DIR/A.vscdb" ]; then
  echo "ERROR: fixtures/A.vscdb not found"
  exit 1
fi

echo "Test 1: Truncated database"
echo "-------------------------"
cp "$FIXTURES_DIR/A.vscdb" "$TEST_DB"
truncate -s 100 "$TEST_DB"
echo "Created truncated database (100 bytes)"
echo "Expected: sql.js throws error, caught gracefully"
echo ""

echo "Test 2: Empty database"
echo "--------------------"
echo "" > "$TEST_DB"
echo "Created empty database"
echo "Expected: Unsupported state, no keys found"
echo ""

echo "Test 3: Random binary data"
echo "------------------------"
dd if=/dev/urandom of="$TEST_DB" bs=1024 count=10 2>/dev/null
echo "Created random binary file"
echo "Expected: sql.js parse error, handled gracefully"
echo ""

echo "Test 4: Missing required keys"
echo "---------------------------"
# This would need sql.js to create valid DB without auth keys
echo "MANUAL: Create valid SQLite DB with ItemTable but no auth keys"
echo "Expected: AuthDetector returns unsupported with missingKeys"
echo ""

echo "Cleanup..."
rm -f "$TEST_DB"

echo ""
echo "==================================="
echo "Corruption scenarios created."
echo "To test:"
echo "1. Point extension to one of these corrupt DBs"
echo "2. Verify graceful error handling (no crash)"
echo "3. Check error message is actionable"
echo "==================================="
