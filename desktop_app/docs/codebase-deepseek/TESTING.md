# Testing

## Core Sections (Required)

### 1) Test Stack and Commands

| Item | Value | Evidence |
|------|-------|----------|
| Test framework | xUnit 2.9.3 with the built-in `Assert` API; no FluentAssertions, Moq, or AutoFixture | `AugmentScale.Tests/AugmentScale.Tests.csproj:13` |
| Test host | Microsoft.NET.Test.Sdk 17.14.1 | `AugmentScale.Tests/AugmentScale.Tests.csproj:12` |
| Runner | xunit.runner.visualstudio 3.1.4 | `AugmentScale.Tests/AugmentScale.Tests.csproj:14` |
| Target | `net10.0-windows`, x64 | `AugmentScale.Tests/AugmentScale.Tests.csproj:3-8` |
| Projects under test | App, Protocol, and ScaleSimulator | `AugmentScale.Tests/AugmentScale.Tests.csproj:17-21` |

Commands (from `desktop_app/`):

```powershell
dotnet test AugmentScale.slnx -c Debug
dotnet test AugmentScale.Tests\AugmentScale.Tests.csproj -c Debug
dotnet build AugmentScale.slnx -c Debug
```

A full run on 2026-10-24 returned `Passed: 77, Failed: 0, Skipped: 0, Total: 77` in 54 seconds. There is no separate unit/integration/e2e command split and no coverage command or threshold configured; use `dotnet test --filter` ad hoc if needed. Evidence: `AugmentScale.Tests/AugmentScale.Tests.csproj`, `USER_MANUAL.md:104-119`.

### 2) Test Layout

| File | Classes / focus | Approximate cases | Evidence |
|------|-----------------|-------------------|----------|
| `AugmentScale.Tests/DatabaseTests.cs` | `TempDatabase` helper, `ConfigServiceTests`, `DatabaseServiceTests`; PIN/secrets, provisioning, profiles, vehicles, ticket lifecycle, boot state, history, report integrity | 26 `[Fact]` cases | `DatabaseTests.cs:8-36`, `:38-82`, `:84-841` |
| `AugmentScale.Tests/ProtocolTests.cs` | Frame decoding, checksum rejection, splitter buffering, decimal/negative weights, stability window/tolerance | 14 `[Fact]` + 1 `[Theory]` (2 cases) = 16 | `ProtocolTests.cs` |
| `AugmentScale.Tests/SimulatorEngineTests.cs` | Manual mode quantization, corruption/garbage injection, tare/load cycles, motion | 8 `[Fact]` cases | `SimulatorEngineTests.cs` |
| `AugmentScale.Tests/SimulatorProtocolTests.cs` | Encoder/decoder round-trips, clamping, TCP name parsing, live loopback transport, read-timeout continuation | 5 `[Fact]` + 4 `[Theory]` (22 cases) = 27 | `SimulatorProtocolTests.cs` |

Test data is created per test in `%TEMP%\AugmentScaleTests\<guid>` by `TempDatabase`, which deletes the directory in `Dispose` (`DatabaseTests.cs:8-36`). No shared database fixture exists.

### 3) Test Scope Matrix

| Scope | Covered? | Typical target | Notes |
|-------|----------|----------------|-------|
| Unit | Yes | Protocol framing/splitter, stability detector, simulator engine, PIN hashing | Deterministic fixtures; no mocks |
| Integration | Yes | SQLCipher database, provisioning, ticket/report lifecycle, loopback TCP transport | Real temp files and real TCP, no external services |
| E2E | No | Operator flows in WPF/WebView2, print, real scale | No UI automation or hardware-in-the-loop suite |

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
| Bridge command routing / timeout | No | No | No | `BridgeService` not instantiated in tests |
| WPF/WebView2 rendering and JS screens | No | No | No | No browser automation or JS test runner |
| Real serial hardware | No | No | No | `ProcessStream` timeout seam only |
| Printing | No | No | No | `window.print()` is not testable in the current harness |
| Cloud sync | N/A | N/A | N/A | Not implemented |

### 4) Mocking and Isolation Strategy

- No mocking library is used. Tests exercise real implementations.
- Database isolation: a fresh temporary directory and a real SQLCipher database per test (`TempDatabase`, `DatabaseTests.cs:8-36`).
- Network isolation: simulator transport tests bind a loopback TCP server and use the production `ScaleReaderService` to read frames (`SimulatorProtocolTests.cs`, `TcpFrameServer.cs`).
- Time/date isolation: history-date tests insert tickets with explicit timestamps rather than changing the system clock (`DatabaseTests.cs:653-674`).
- Hardware/timeout seam: `ScaleReaderService.ProcessStream` accepts an internal `keepRunning` predicate and tests get access through `InternalsVisibleTo`; the source marks this as temporary (`ScaleReaderService.cs:136-141`, `AugmentScale.csproj:31-32`).
- Determinism: protocol fixtures and simulator quantization are deterministic; the TCP transport test depends on loopback timing and is the most timing-sensitive test.

### 5) Coverage and Quality Signals

- Current signal: 77/77 tests pass; 0 failed, 0 skipped, 54 seconds.
- Strengths: high-value ticket lifecycle, vehicle/ticket interaction, encrypted database provisioning, report snapshot integrity, and protocol edge cases are covered.
- Coverage tooling: none. No Coverlet/`coverlet.collector`, no threshold, and no published coverage report.
- Notable gaps:
  - No tests for `BridgeService` command routing, authorization expiry, JSON mapping, or the 30-second timeout.
  - No tests for `MainWindow`/WebView2 startup, navigation failure, DevTools, or virtual-host security settings.
  - No automated tests for any WebUI screen, `runtime.js`, `state.js`, `html-loader.js`, or print flow.
  - No hardware-in-the-loop serial test and no test for the reconnect delay.
  - No CI job, pre-commit hook, or branch-protection evidence; the suite is manual.
- Maintenance signals: `DatabaseTests.cs` is 841 lines and centralizes many domains; adding unrelated features tends to extend this file.

### 6) Evidence

- `AugmentScale.Tests/AugmentScale.Tests.csproj`
- `AugmentScale.Tests/DatabaseTests.cs`
- `AugmentScale.Tests/ProtocolTests.cs`
- `AugmentScale.Tests/SimulatorEngineTests.cs`
- `AugmentScale.Tests/SimulatorProtocolTests.cs`
- `AugmentScale/Services/ScaleReaderService.cs`
- `AugmentScale/AugmentScale.csproj`
- `USER_MANUAL.md`
