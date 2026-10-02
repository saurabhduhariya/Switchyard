#!/bin/bash
# Test: Attempt to switch with read-only database
# Expected: Clear error message, no corruption

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES_DIR="$SCRIPT_DIR/fixtures"
TEST_DB="$FIXTURES_DIR/test-readonly.vscdb"

echo "==================================="
echo "Failure Test: Read-Only Database"
echo "==================================="

# Setup
if [ ! -f "$FIXTURES_DIR/A.vscdb" ]; then
  echo "ERROR: fixtures/A.vscdb not found"
  exit 1
fi

echo "Setting up read-only test database..."
cp "$FIXTURES_DIR/A.vscdb" "$TEST_DB"
chmod 444 "$TEST_DB"

echo "Database permissions:"
ls -l "$TEST_DB"

echo ""
echo "Expected behavior when attempting TokenSwap switch:"
echo "1. Extension should detect write will fail"
echo "2. Clear error message shown to user"
echo "3. Database remains unchanged"
echo "4. No crash or hang"
echo ""

echo "MANUAL TEST STEPS:"
echo "1. Set switchyard.mode = tokenSwap"
echo "2. Configure helper to use $TEST_DB"
echo "3. Attempt to switch accounts"
echo "4. Verify error message is clear"
echo ""

# Simulate write attempt
echo "Simulating write attempt..."
if touch "$TEST_DB" 2>/dev/null; then
  echo "❌ FAIL: Was able to write to read-only file!"
  chmod 644 "$TEST_DB"  # Restore before exit
  exit 1
else
  echo "✓ PASS: Write correctly blocked by permissions"
fi

# Verify read still works
if [ -r "$TEST_DB" ]; then
  echo "✓ PASS: Read access still available"
else
  echo "❌ FAIL: Can't read database"
fi

# Cleanup
chmod 644 "$TEST_DB"
rm -f "$TEST_DB"

echo ""
echo "==================================="
echo "Test complete."
echo "Read-only scenario verified at filesystem level."
echo "Manual test in IDE required for full UX check."
echo "==================================="
