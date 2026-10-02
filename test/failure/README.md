# Failure Injection Tests

This directory contains scripts to test failure scenarios and edge cases in Switchyard.

## Purpose

These tests verify that the extension handles failures gracefully:
- Helper killed at various stages
- Database corruption
- File system errors
- Permission issues
- Race conditions

## Tests

### 1. Kill Helper Mid-Switch (`kill-helper.sh`)

Tests what happens when the helper process is killed at different stages:
- After backup but before write
- After write but before verification
- After verification but before relaunch

**Expected behavior:** Original database restored, error reported

### 2. Read-Only Database (`readonly-db.sh`)

Makes the database read-only and attempts a switch.

**Expected behavior:** Error reported, no data loss

### 3. Delete Backup Mid-Switch (`delete-backup.sh`)

Removes backup directory while switch is in progress.

**Expected behavior:** Switch may fail but no corruption

### 4. Corrupt Database (`corrupt-db.sh`)

Truncates or corrupts the database file.

**Expected behavior:** Unsupported state, clear error message

### 5. Disk Full Simulation (`disk-full.sh`)

Simulates disk full condition during write.

**Expected behavior:** Atomic write prevents partial files

## Running Tests

**IMPORTANT: These tests are DESTRUCTIVE and should only be run in a test environment with backup accounts.**

### Prerequisites

1. Test Antigravity IDE installation (not your main one)
2. Backup all important data
3. At least 2 test Google accounts (A and B)
4. Switchyard extension installed

### Setup

```bash
# 1. Create test state.vscdb copies
cp ~/.config/Antigravity\ IDE/User/globalStorage/state.vscdb test/failure/fixtures/A.vscdb
# Sign out, sign in with account B
cp ~/.config/Antigravity\ IDE/User/globalStorage/state.vscdb test/failure/fixtures/B.vscdb

# 2. Make scripts executable
chmod +x test/failure/*.sh
```

### Execute

```bash
# Run individual test
./test/failure/kill-helper.sh

# Or run all tests
./test/failure/run-all.sh
```

### Cleanup

```bash
./test/failure/cleanup.sh
```

## Test Matrix

| Scenario | Expected Result | Verified |
|----------|----------------|----------|
| Helper killed after backup | Rollback to original account | ⏳ |
| Helper killed after write | Verification fails → rollback | ⏳ |
| Helper killed after verify | Relaunch may fail → manual recovery | ⏳ |
| DB read-only | Error message, no write attempted | ⏳ |
| Backup dir deleted | Switch fails, error reported | ⏳ |
| DB truncated | Unsupported guard triggers | ⏳ |
| Disk full | No partial .tmp file left | ⏳ |
| Permission denied | Clear error, no corruption | ⏳ |
| Two windows open | Warning shown | ⏳ |
| Extension disabled mid-switch | Helper completes, reconcile works | ⏳ |

## Automated Checks

After each test:
- ✅ Original account still works
- ✅ No partial files left in temp
- ✅ Backup exists and is valid
- ✅ Error logged to Output → Switchyard
- ✅ User sees actionable error message

## Safety

These scripts:
- ✅ Run in isolated test directory
- ✅ Use copies of databases, not originals
- ✅ Verify backup exists before proceeding
- ✅ Restore original state on failure
- ❌ **Never run on production accounts**

## Interpretation

- **PASS**: Error handled gracefully, no data loss, clear message
- **FAIL**: Crash, corruption, data loss, or unclear error
- **WARN**: Works but message could be clearer

## Contributing

When adding new failure scenarios:
1. Document expected behavior
2. Add to test matrix
3. Ensure cleanup script handles it
4. Never commit real credentials
