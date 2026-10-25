# Testing Patterns

## Core Sections (Required)

### 1) Test Stack and Commands

| Item | Value | Evidence |
|------|-------|----------|
| Test framework | xUnit 2.9.3 with the built-in `Assert` API; no FluentAssertions, Moq, or AutoFixture | `AugmentScale.Tests/AugmentScale.Tests.csproj:13` |
| Test host | Microsoft.NET.Test.Sdk 17.14.1 | `AugmentScale.Tests/AugmentScale.Tests.csproj:12` |
| Runner | xunit.runner.visualstudio 3.1.4 | `AugmentScale.Tests/AugmentScale.Tests.csproj:14` |
| Target | `net10.0-windows`, x64 | `AugmentScale.Tests/AugmentScale.Tests.csproj:3-8` |
| Projects under test | App, Protocol, and ScaleSimulator | `AugmentScale.Tests/AugmentScale.Tests.csproj:17-21` |
| Assertion/mocking tools | Built-in `Xunit.Assert`, custom loopback TCP servers (`TcpListener`), custom stream implementations (`TimeoutThenFrameStream`) | `SimulatorProtocolTests.cs`, `ScaleReaderService.cs:136-141` |

Commands (from `desktop_app/`):

```powershell
# Run all tests
dotnet test AugmentScale.slnx -c Debug

# Run the suite through the test project
dotnet test AugmentScale.Tests\AugmentScale.Tests.csproj -c Debug

# Run a specific test class
dotnet test AugmentScale.slnx -c Debug --filter "FullyQualifiedName~ProtocolTests"

# Run tests with detailed console logger
dotnet test AugmentScale.slnx -c Debug --logger "console;verbosity=detailed"

# Build only (the project's only static gate)
dotnet build AugmentScale.slnx -c Debug
```

A full run on 2026-10-25 after the PDF archive work returned `Passed: 82, Failed: 0, Skipped: 0, Total: 82` in about 33 seconds; an earlier cold/loaded run took about 1 minute 9 seconds. The prior persistence-refactor baseline was `Passed: 77, Failed: 0, Total: 77` in roughly 26–34 seconds. There is no separate unit/integration/e2e command split and no coverage command or threshold configured; use `dotnet test --filter` ad hoc if needed. Evidence: `AugmentScale.Tests/AugmentScale.Tests.csproj`.

### 2) Test Layout

| File | Classes / focus | Approximate cases | Evidence |
|------|-----------------|-------------------|----------|
| `AugmentScale.Tests/DatabaseTests.cs` | `TempDatabase` helper, `ConfigServiceTests`, `DatabaseServiceTests`; PIN/secrets, provisioning, profiles, vehicles, ticket lifecycle, boot state, history, report integrity (exercises the `DatabaseService` facade and its domain repositories/services) | 26 `[Fact]` cases | `DatabaseTests.cs:8-36`, `:38-82`, `:84-715` |
| `AugmentScale.Tests/ProtocolTests.cs` | Frame decoding, checksum rejection, splitter buffering, decimal/negative weights, stability window/tolerance | 14 `[Fact]` + 1 `[Theory]` (2 cases) = 16 | `ProtocolTests.cs` |
| `AugmentScale.Tests/SimulatorEngineTests.cs` | Manual mode quantization, corruption/garbage injection, tare/load cycles, motion | 8 `[Fact]` cases | `SimulatorEngineTests.cs` |
| `AugmentScale.Tests/SimulatorProtocolTests.cs` | Encoder/decoder round-trips, clamping, TCP name parsing, live loopback transport, read-timeout continuation | 5 `[Fact]` + 4 `[Theory]` (22 cases) = 27 | `SimulatorProtocolTests.cs` |
| `AugmentScale.Tests/PdfArchiveTests.cs` | Archive schema, report generation, baseline/daily scheduling, empty-day skip, failure/manual retry, repository transitions | 5 `[Fact]` cases | `PdfArchiveTests.cs` |

- Test file placement pattern: separate test project at `AugmentScale.Tests/` referencing the production projects (`AugmentScale`, `AugmentScale.Protocol`, `AugmentScale.ScaleSimulator`).
- Naming convention: files named `*Tests.cs`; test methods follow `Method_Scenario_ExpectedBehavior` (e.g. `TicketLifecycle_CreateCompleteReprintVoid`, `HistoryReport_RejectsWrongPinWithoutAuditAndHashesSuccessfulSnapshot`).
- Setup files and isolation: `DatabaseTests.cs:8-36` defines `TempDatabase : IDisposable`, which creates an isolated SQLCipher instance in `%TEMP%\AugmentScaleTests\<guid>` per test and deletes it on disposal. No shared database fixture exists. `PdfArchiveTests` uses the same helper, a fake `IPdfArchiveRenderer`, and an injected clock so no WebView2 or real file renderer is required.

### 3) Test Scope Matrix

| Scope | Covered? | Typical target | Notes |
|-------|----------|----------------|-------|
| Unit | Yes | `AugmentScale.Protocol` (decoders, splitters, encoders, stability variance), simulator engine, PIN hashing | Fast, pure CPU tests with deterministic fixtures; no mocks |
| Integration | Yes | `DatabaseService`, `ConfigService`, `ScaleReaderService` TCP stream | Executes real migrations, transactions, PBKDF2 hashing, and loopback TCP sockets |
| E2E | No | WebView2 full user interface, print, real scale | `[TODO]` WebUI interactions are currently tested manually in a browser and the desktop shell |

| Area | Unit | Integration | E2E/UI | Notes |
|------|------|-------------|--------|-------|
| XK3190 frame decode/checksum | Yes | — | — | Real captured frame and synthetic fixtures |
| Frame splitter / partial / newline streams | Yes | — | — | Includes mixed line endings and garbage prefixes |
| Stability detector | Yes | — | — | 3-sample minimum, tolerance, window expiry |
| Simulator engine and TCP transport | — | Yes | — | Loopback TCP test in `SimulatorProtocolTests.TcpTransport_PublishesDecodedReadings` |
| PIN hashing and seeded authentication | Yes | Yes | — | PBKDF2 verification and seeded operator login |
| Secrets loss/corruption behavior | — | Yes | — | Existing DB with missing `secrets.dat` refuses to create a new key |
| Schema provisioning/seed | — | Yes | — | 5 operators, 5 vehicles, ticket 11353 |
| Profile lifecycle and supervisor rules | — | Yes | — | Create/update/deactivate, duplicates, last-supervisor guard |
| Vehicle lifecycle | — | Yes | — | Archive blocked by open ticket; delete requires archive and preserves ticket history |
| Ticket lifecycle | — | Yes | — | Create, duplicate guard, complete, reprint, void, soft-delete, numbering |
| Anomaly override | — | Yes | — | High net weight requires a reason/override |
| History queries and reports | — | Yes | — | Range filters, inclusive dates, SHA-256 report snapshot verification |
| PDF archive scheduling | Yes | Yes | — | Baseline/daily enqueue, empty-day skip, failure/backoff, manual retry, archive report actor |
| WebView2 PDF rendering | No | No | No | Manual harness/desktop verification only; fake renderer used in tests |
| Bridge command routing / timeout | No | No | No | `BridgeService` not instantiated in tests |
| WPF/WebView2 rendering and JS screens | No | No | No | No browser automation or JS test runner |
| Real serial hardware | No | No | No | `ProcessStream` timeout seam only |
| Printing | No | No | No | `window.print()` is not testable in the current harness |
| Cloud sync | N/A | N/A | N/A | Not implemented |

### 4) Mocking and Isolation Strategy

- No mocking library is used. Tests exercise real implementations.
- Database isolation: a fresh temporary directory and a real SQLCipher database per test (`TempDatabase`, `DatabaseTests.cs:8-36`). Each instance creates isolated encryption keys, schema, and tables; no test touches production data at `%LOCALAPPDATA%\AugmentScale`.
- Network/serial isolation: `ScaleReaderService` supports `TCP:host:port` connections, allowing tests to run against an in-process `TcpListener` instead of physical COM ports. Simulator transport tests bind a loopback TCP server and use the production reader (`SimulatorProtocolTests.cs`, `TcpFrameServer.cs`).
- Stream simulation: subclasses of `System.IO.Stream` (e.g. `TimeoutThenFrameStream`) verify serial timeout recovery without hardware.
- Time/date isolation: history-date tests insert tickets with explicit timestamps rather than changing the system clock (`DatabaseTests.cs:653-674`).
- Hardware/timeout seam: `ScaleReaderService.ProcessStream` accepts an internal `keepRunning` predicate, and tests access it through `InternalsVisibleTo`; the source marks this as temporary (`ScaleReaderService.cs:136-141`, `AugmentScale.csproj:31-32`).
- Determinism: protocol fixtures and simulator quantization are deterministic; `SimulatorProtocolTests.TcpTransport_PublishesDecodedReadings` depends on loopback timing and is the most timing-sensitive test.
- Common failure mode: file locking on temporary-directory deletion (`IOException` in `TempDatabase.Dispose`) is handled gracefully.

### 5) Coverage and Quality Signals

- Coverage tool + threshold: `[TODO]` — no Coverlet/`coverlet.collector`, no automated code coverage tool, and no threshold configured in build scripts or project files. No published coverage report exists.
- Current reported signal: 82/82 tests pass; 0 failed, 0 skipped; about 33 seconds on the latest 2026-10-25 run, with an earlier cold/loaded run taking about 1 minute 9 seconds.
- Strengths: high-value ticket lifecycle, vehicle/ticket interaction, encrypted database provisioning, report snapshot integrity, archive scheduling/retry, and protocol edge cases are covered.
- Known gaps/flaky areas:
  - No tests for `BridgeService` command routing, authorization expiry, JSON mapping, or the 30-second timeout.
  - No tests for `MainWindow`/WebView2 startup, navigation failure, DevTools, or virtual-host security settings.
  - No automated tests for any WebUI screen, `runtime.js`, `state.js`, `html-loader.js`, or print flow.
  - No automated test for the real hidden-WebView2 `PrintToPdfAsync` renderer or the generated PDF layout; `PdfArchiveTests` uses a fake renderer. A manual harness verified a one-page A4 PDF, but this is not part of the suite.
  - No hardware-in-the-loop serial test and no test for the reconnect delay.
  - No CI job, pre-commit hook, branch-protection evidence, linting, or coverage gate; the suite is run manually.
  - Full test suite takes roughly 33–70 seconds because multiple database tests each perform PBKDF2 key derivations (100,000 iterations per seeded operator) and archive tests create real SQLCipher databases.
- Maintenance signals: `DatabaseTests.cs` is 715 lines and centralizes many domains; adding unrelated features tends to extend this file. The persistence split is covered through the `DatabaseService` facade; there are no repository-specific test classes yet.

### 6) Evidence

- `AugmentScale.Tests/AugmentScale.Tests.csproj`
- `AugmentScale.Tests/DatabaseTests.cs`
- `AugmentScale.Tests/ProtocolTests.cs`
- `AugmentScale.Tests/SimulatorEngineTests.cs`
- `AugmentScale.Tests/SimulatorProtocolTests.cs`
- `AugmentScale.Tests/PdfArchiveTests.cs`
- `AugmentScale/Services/PdfArchiveService.cs`
- `AugmentScale/Services/WebViewPdfArchiveRenderer.cs`
- `AugmentScale/Data/Repositories/ArchiveRunRepository.cs`
- `AugmentScale/Services/ScaleReaderService.cs`
- `AugmentScale/Data/Repositories/`
- `AugmentScale/Data/Services/`
- `AugmentScale/AugmentScale.csproj`
- `USER_MANUAL.md`
- Terminal execution output of `dotnet test AugmentScale.slnx -c Debug`
