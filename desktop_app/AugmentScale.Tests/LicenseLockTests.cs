using System.Net;
using System.Text;
using System.Text.Json;
using AugmentScale.Models;
using AugmentScale.Models.Commands;
using AugmentScale.Services;
using Microsoft.Data.Sqlite;
using Xunit;

namespace AugmentScale.Tests;

public class LicenseLockTests
{
    private static JsonElement ToJsonElement(object obj)
    {
        var json = JsonSerializer.Serialize(obj);
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    [Fact]
    public async Task CloudControlService_RemoteLicenseDeactivation_SetsLicenseActiveFalse()
    {
        using var temp = new TempDatabase();

        var handler = new CloudControlServiceTests.MockSupabaseHandler((req) =>
        {
            if (req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("workstation_controls"))
            {
                var json = """
                    [
                        {
                            "workstation_id": "test-ws",
                            "organization_id": "test-org",
                            "license_active": false,
                            "enable_cloud_sync": true,
                            "enable_cloud_backup": false,
                            "trigger_immediate_backup": false
                        }
                    ]
                    """;
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json")
                };
            }

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{}", Encoding.UTF8, "application/json")
            };
        });

        using var httpClient = new HttpClient(handler);
        using var cloud = new CloudControlService(temp.Database, temp.Config, httpClient);

        var status = await cloud.SyncNowAsync();

        Assert.False(cloud.LicenseActive);
        Assert.False(status.LicenseActive);

        // Verify SQLite license_cache reflects license_active = 0
        using var conn = temp.Database.OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT license_active FROM license_cache WHERE id = 'current';";
        var val = Convert.ToInt32(cmd.ExecuteScalar());
        Assert.Equal(0, val);

        // Verify SyncStatusService reports licenseActive = false
        var syncStatus = temp.Database.GetSyncStatus();
        Assert.False(syncStatus.LicenseActive);
    }

    [Fact]
    public void CloudControlService_Startup_LoadsInactiveLicenseFromCache()
    {
        using var temp = new TempDatabase();

        // Write inactive license directly to license_cache
        using (var conn = temp.Database.OpenConnection())
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                INSERT INTO license_cache (id, license_active, enable_cloud_sync, cached_at)
                VALUES ('current', 0, 1, datetime('now'))
                ON CONFLICT(id) DO UPDATE SET license_active = 0;
            """;
            cmd.ExecuteNonQuery();
        }

        // Instantiate CloudControlService without network cycle
        var handler = new CloudControlServiceTests.MockSupabaseHandler((_) => throw new HttpRequestException("Network unreachable"));
        using var httpClient = new HttpClient(handler);
        using var cloud = new CloudControlService(temp.Database, temp.Config, httpClient);

        // LicenseActive must immediately be false from cache
        Assert.False(cloud.LicenseActive);
    }

    [Fact]
    public async Task CloudControlService_OfflineGraceExpired_SetsLicenseActiveFalse()
    {
        using var temp = new TempDatabase();

        // Seed license_cache with last success 35 days ago (grace period is 30 days)
        var thirtyFiveDaysAgo = DateTimeOffset.UtcNow.AddDays(-35).ToString("O");
        using (var conn = temp.Database.OpenConnection())
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                INSERT INTO license_cache (id, license_active, last_cloud_success_at, enable_cloud_sync, cached_at)
                VALUES ('current', 1, $lastSuccess, 1, datetime('now'))
                ON CONFLICT(id) DO UPDATE SET last_cloud_success_at = $lastSuccess;
            """;
            cmd.Parameters.AddWithValue("$lastSuccess", thirtyFiveDaysAgo);
            cmd.ExecuteNonQuery();
        }

        var handler = new CloudControlServiceTests.MockSupabaseHandler((_) => throw new HttpRequestException("Network unreachable"));
        using var httpClient = new HttpClient(handler);
        using var cloud = new CloudControlService(temp.Database, temp.Config, httpClient);

        await cloud.SyncNowAsync();

        Assert.False(cloud.LicenseActive);

        // Verify SyncStatusService also detects expired grace
        var syncStatus = temp.Database.GetSyncStatus();
        Assert.False(syncStatus.LicenseActive);
    }

    [Fact]
    public async Task BridgeService_LicenseInactive_BlocksOperationalCommands()
    {
        using var temp = new TempDatabase();
        using var scale = new ScaleReaderService(temp.Config, temp.Database);
        var bridge = new BridgeService(temp.Database, scale);

        // Setup mock cloud service with inactive license
        var handler = new CloudControlServiceTests.MockSupabaseHandler((_) =>
        {
            var json = """
                [
                    {
                        "workstation_id": "test-ws",
                        "organization_id": "test-org",
                        "license_active": false,
                        "enable_cloud_sync": true
                    }
                ]
                """;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
        });
        using var httpClient = new HttpClient(handler);
        using var cloud = new CloudControlService(temp.Database, temp.Config, httpClient);
        await cloud.SyncNowAsync();

        bridge.Cloud = cloud;
        Assert.False(bridge.IsLicenseActive());

        // 1. authenticatePin must fail
        var authEx = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            bridge.DispatchAsync("authenticatePin", ToJsonElement(new { operatorId = "op-1", pin = "1234" })));
        Assert.Contains("license is inactive", authEx.Message, StringComparison.OrdinalIgnoreCase);

        // 2. createTicket must fail
        var createEx = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            bridge.DispatchAsync("createTicket", ToJsonElement(new CreateTicketRequest
            {
                TruckNo = "TRK-001",
                Direction = "inbound",
                WeightKg = 15000,
            })));
        Assert.Contains("license is inactive", createEx.Message, StringComparison.OrdinalIgnoreCase);

        // 3. completeTicket must fail
        var completeEx = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            bridge.DispatchAsync("completeTicket", ToJsonElement(new CompleteTicketRequest
            {
                TicketId = 1,
                WeightKg = 5000,
            })));
        Assert.Contains("license is inactive", completeEx.Message, StringComparison.OrdinalIgnoreCase);

        // 4. voidTicket must fail
        var voidEx = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            bridge.DispatchAsync("voidTicket", ToJsonElement(new TicketReasonRequest
            {
                TicketId = 1,
                Reason = "Test void",
            })));
        Assert.Contains("license is inactive", voidEx.Message, StringComparison.OrdinalIgnoreCase);

        // 5. registerVehicle must fail
        var regEx = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            bridge.DispatchAsync("registerVehicle", ToJsonElement(new VehicleRequest
            {
                Plate = "NEW-999",
            })));
        Assert.Contains("license is inactive", regEx.Message, StringComparison.OrdinalIgnoreCase);

        // 6. createProfile must fail
        var profEx = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            bridge.DispatchAsync("createProfile", ToJsonElement(new ProfileWriteRequest
            {
                DisplayName = "Test Operator",
                Token = "some-token",
            })));
        Assert.Contains("license is inactive", profEx.Message, StringComparison.OrdinalIgnoreCase);

        // 7. captureReading must fail
        var capEx = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            bridge.DispatchAsync("captureReading", ToJsonElement(new { })));
        Assert.Contains("license is inactive", capEx.Message, StringComparison.OrdinalIgnoreCase);

        // 8. showSystemPrintDialog must fail
        var printEx = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            bridge.DispatchAsync("showSystemPrintDialog", ToJsonElement(new { })));
        Assert.Contains("license is inactive", printEx.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task BridgeService_LicenseInactive_PermitsDiagnosticsAndSync()
    {
        using var temp = new TempDatabase();
        using var scale = new ScaleReaderService(temp.Config, temp.Database);
        var bridge = new BridgeService(temp.Database, scale);

        var handler = new CloudControlServiceTests.MockSupabaseHandler((_) =>
        {
            var json = """
                [
                    {
                        "workstation_id": "test-ws",
                        "organization_id": "test-org",
                        "license_active": false,
                        "enable_cloud_sync": true
                    }
                ]
                """;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
        });
        using var httpClient = new HttpClient(handler);
        using var cloud = new CloudControlService(temp.Database, temp.Config, httpClient);
        await cloud.SyncNowAsync();

        bridge.Cloud = cloud;

        // getSyncStatus must succeed
        var syncResult = await bridge.DispatchAsync("getSyncStatus", ToJsonElement(new { }));
        Assert.NotNull(syncResult);
        var syncDto = Assert.IsType<SyncStatusDto>(syncResult);
        Assert.False(syncDto.LicenseActive);

        // getCloudStatus must succeed
        var cloudResult = await bridge.DispatchAsync("getCloudStatus", ToJsonElement(new { }));
        Assert.NotNull(cloudResult);

        // getBootState must succeed
        var bootResult = await bridge.DispatchAsync("getBootState", ToJsonElement(new { }));
        Assert.NotNull(bootResult);
        var bootDto = Assert.IsType<BootStateDto>(bootResult);
        Assert.False(bootDto.Sync.LicenseActive);

        // syncNow must succeed
        var syncNowResult = await bridge.DispatchAsync("syncNow", ToJsonElement(new { }));
        Assert.NotNull(syncNowResult);
    }
}
