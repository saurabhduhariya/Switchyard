#!/bin/bash
# Run all failure injection tests
# WARNING: Destructive tests - use test environment only

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=========================================="
echo "Switchyard Failure Injection Test Suite"
echo "=========================================="
echo ""
echo "⚠️  WARNING: These are DESTRUCTIVE tests"
echo "Only run in a test environment with backup accounts"
echo ""
read -p "Continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "Running all failure tests..."
echo ""

# Make scripts executable
chmod +x "$SCRIPT_DIR"/*.sh

# Track results
PASSED=0
FAILED=0
WARNED=0

run_test() {
  local test_script="$1"
  local test_name=$(basename "$test_script" .sh)
  
  echo ""
  echo "=========================================="
  echo "Running: $test_name"
  echo "=========================================="
  
  if bash "$test_script"; then
    echo "✓ $test_name completed"
    ((PASSED++))
  else
    echo "❌ $test_name failed"
    ((FAILED++))
  fi
}

# Run each test
run_test "$SCRIPT_DIR/readonly-db.sh"
run_test "$SCRIPT_DIR/corrupt-db.sh"
run_test "$SCRIPT_DIR/kill-helper.sh"

echo ""
echo "=========================================="
echo "Test Suite Complete"
echo "=========================================="
echo "Passed: $PASSED"
echo "Failed: $FAILED"
echo "Manual tests required: See individual test output"
echo ""
echo "Next steps:"
echo "1. Review logs in Output → Switchyard"
echo "2. Run manual IDE tests for UX verification"
echo "3. Check for temp file leaks: ls /tmp/switchyard-*"
echo "=========================================="

exit $FAILED
