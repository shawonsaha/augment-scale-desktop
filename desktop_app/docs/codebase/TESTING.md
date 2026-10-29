# Testing Patterns

## Core Sections (Required)

### 1) Test Stack and Commands

- Primary test framework: xUnit 2.9.3 with Visual Studio test runner 3.1.4 and .NET Test SDK 17.14.1
- Assertion/mocking tools: Built-in xUnit assertion library (`Assert.*`), custom test doubles (`TempDatabase` fixture, `IPdfArchiveRenderer` test mocks, mock HTTP handlers)
- Commands:

```bash
# Run all tests in the solution (112 unit and integration tests)
dotnet test AugmentScale.slnx

# Run specific test file or namespace
dotnet test --filter "FullyQualifiedName~AugmentScale.Tests.ProtocolTests"

# Run tests with verbose console logging
dotnet test AugmentScale.slnx --logger "console;verbosity=detailed"
```

### 2) Test Layout

- Test file placement pattern: Centralized in `AugmentScale.Tests` project alongside the main solution projects.
- Naming convention: `<Subsystem>Tests.cs` (e.g., `ProtocolTests.cs`, `DatabaseTests.cs`, `PdfArchiveTests.cs`, `SimulatorEngineTests.cs`).
- Setup files and where they run:
  - `TempDatabase` fixture defined in [DatabaseTests.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.Tests/DatabaseTests.cs#L10) creates an isolated temporary directory in `%TEMP%\AugmentScaleTests\<guid>` with a fresh SQLCipher database and seeds initial data, completely deleted on `Dispose()`.

### 3) Test Scope Matrix

| Scope | Covered? | Typical target | Notes |
|-------|----------|----------------|-------|
| Unit | Yes | XK3190 protocol framing, checksum calculation, rolling window stability detector, simulator state machine | Thorough test cases with known hardware frames and edge conditions |
| Integration | Yes | SQLite schema migrations (V001-V006), encrypted SQLCipher database CRUD, ticket lifecycle (create, complete, reprint, void, soft-delete), vehicle auto-registration, outbox sequence watermarks, outbox dead-letter queue unblocking | Runs against real encrypted SQLCipher database instances using temporary directories |
| E2E | Partial | Simulator TCP broadcast to scale reader loop, PDF archive generation flow | WebUI user interface clicks and WebView2 browser interactions are currently verified manually |

### 4) Mocking and Isolation Strategy

- Main mocking approach:
  - File system & Database: Isolated temporary folder (`TempDatabase`) per test ensures zero cross-test state leakage.
  - PDF Rendering: `IPdfArchiveRenderer` mock implementation intercepts render requests and simulates successful or failed exports without spawning a Chromium process.
  - Hardware Scale: Test feeds byte arrays directly into `Xk3190FrameDecoder` or streams TCP frames from local `TcpFrameServer`.
- Isolation guarantees: Each database test allocates a new random folder path and cryptographic key; all resources are freed and purged on fixture disposal.
- Common failure mode in tests: File locking if a test fails before closing a SQLite connection or disposing a file handle.

### 5) Coverage and Quality Signals

- Coverage tool + threshold: [TODO] (Code coverage tooling not configured in CI/build scripts; test count tracked manually).
- Current reported coverage: 112 test cases passing (0 failed, 0 skipped).
- Known gaps/flaky areas:
  - Ticket repository has full lifecycle coverage (`TicketLifecycle_CreateCompleteReprintVoid`), but UI-driven end-to-end interactions with WebView2 are not automated.
  - Two xUnit analyzer warnings on collection size assertions (`Assert.Equal(1, collection.Count)` vs `Assert.Single`).

### 6) Evidence

- [AugmentScale.Tests/AugmentScale.Tests.csproj](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.Tests/AugmentScale.Tests.csproj)
- [AugmentScale.Tests/DatabaseTests.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.Tests/DatabaseTests.cs)
- [AugmentScale.Tests/ProtocolTests.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.Tests/ProtocolTests.cs)
- [AugmentScale.Tests/PdfArchiveTests.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.Tests/PdfArchiveTests.cs)
- [AugmentScale.Tests/SimulatorProtocolTests.cs](file:///C:/Users/Shawon/Documents/MEGA/weight-scale/weight-scale-onsite-testing-report/prototype-to-production/desktop_app/AugmentScale.Tests/SimulatorProtocolTests.cs)
