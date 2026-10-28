using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using AugmentScale.Models;
using AugmentScale.Models.Commands;
using AugmentScale.Services;
using Microsoft.Data.Sqlite;
using Xunit;

namespace AugmentScale.Tests;

public class CloudControlServiceTests
{
    [Fact]
    public void SchemaV003_CreatesLicenseCacheAndSyncCursorColumns()
    {
        using var temp = new TempDatabase();
        using var conn = temp.Database.OpenConnection();

        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM license_cache;";
        var count = Convert.ToInt32(cmd.ExecuteScalar());
        Assert.True(count >= 0);

        using var cmd2 = conn.CreateCommand();
        cmd2.CommandText = "SELECT last_cloud_sync_at, last_cloud_sequence, cloud_status FROM sync_cursors WHERE id = 'local';";
        using var reader = cmd2.ExecuteReader();
        Assert.True(reader.Read());
    }

    [Fact]
    public async Task CloudControlService_OnlineHeartbeatAndControlsRead()
    {
        using var temp = new TempDatabase();

        var handler = new MockSupabaseHandler((req) =>
        {
            if (req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("workstation_controls"))
            {
                var json = """
                    [
                        {
                            "workstation_id": "test-ws",
                            "organization_id": "test-org",
                            "license_active": true,
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

        Assert.Equal("online", cloud.Status);
        Assert.True(cloud.LicenseActive);
        Assert.True(cloud.CloudSyncEnabled);
        Assert.NotNull(cloud.LastHeartbeatAt);
    }

    [Fact]
    public async Task CloudControlService_OfflineGracePeriodActive()
    {
        using var temp = new TempDatabase();

        var handler = new MockSupabaseHandler((_) => throw new HttpRequestException("Network unreachable"));
        using var httpClient = new HttpClient(handler);
        using var cloud = new CloudControlService(temp.Database, temp.Config, httpClient);

        var status = await cloud.SyncNowAsync();

        Assert.Equal("offline", cloud.Status);
        Assert.True(cloud.LicenseActive); // Active within 30-day grace period
    }

    [Fact]
    public async Task CloudControlService_RemoteSyncPause()
    {
        using var temp = new TempDatabase();

        var handler = new MockSupabaseHandler((req) =>
        {
            if (req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("workstation_controls"))
            {
                var json = """
                    [
                        {
                            "workstation_id": "test-ws",
                            "organization_id": "test-org",
                            "license_active": true,
                            "enable_cloud_sync": false,
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

        await cloud.SyncNowAsync();

        Assert.Equal("paused", cloud.Status);
        Assert.False(cloud.CloudSyncEnabled);
    }

    [Fact]
    public async Task CloudControlService_StreamsOutboxEventsAndMarksAccepted()
    {
        using var temp = new TempDatabase();

        // Seed an outbox event directly
        using (var conn = temp.Database.OpenConnection())
        using (var txn = conn.BeginTransaction())
        {
            using var cmd = conn.CreateCommand();
            cmd.Transaction = txn;
            cmd.CommandText = """
                INSERT INTO outbox_events (
                    id, sequence, entity_type, entity_id, operation, payload, workstation_id, operator_id, status, created_at
                ) VALUES (
                    'evt-100', 100, 'vehicles', 'veh-100', 'insert', '{"plateNumber":"DM-TEST-01"}', 'ws-1', 'op-1', 'pending', datetime('now')
                );
                """;
            cmd.ExecuteNonQuery();
            txn.Commit();
        }

        var interceptedPost = false;
        var handler = new MockSupabaseHandler((req) =>
        {
            if (req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("workstation_controls"))
            {
                var json = """
                    [
                        {
                            "workstation_id": "test-ws",
                            "organization_id": "test-org",
                            "license_active": true,
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

            if (req.Method == HttpMethod.Post && req.RequestUri!.AbsolutePath.Contains("vehicles"))
            {
                interceptedPost = true;
                return new HttpResponseMessage(HttpStatusCode.Created)
                {
                    Content = new StringContent("{}", Encoding.UTF8, "application/json")
                };
            }

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{}", Encoding.UTF8, "application/json")
            };
        });

        using var httpClient = new HttpClient(handler);
        using var cloud = new CloudControlService(temp.Database, temp.Config, httpClient);

        await cloud.SyncNowAsync();

        Assert.True(interceptedPost);

        // Check that outbox event status is now 'accepted'
        using (var conn = temp.Database.OpenConnection())
        {
            using var check = conn.CreateCommand();
            check.CommandText = "SELECT status FROM outbox_events WHERE id = 'evt-100';";
            var status = check.ExecuteScalar() as string;
            Assert.Equal("accepted", status);
        }
    }

    [Fact]
    public async Task CloudControlService_AutomaticallySyncsWhenOutboxEnqueued()
    {
        using var temp = new TempDatabase();

        var interceptedPost = false;
        var handler = new MockSupabaseHandler((req) =>
        {
            if (req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("workstation_controls"))
            {
                var json = """
                    [
                        {
                            "workstation_id": "test-ws",
                            "organization_id": "test-org",
                            "license_active": true,
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

            if (req.Method == HttpMethod.Post && req.RequestUri!.AbsolutePath.Contains("vehicles"))
            {
                interceptedPost = true;
                return new HttpResponseMessage(HttpStatusCode.Created)
                {
                    Content = new StringContent("{}", Encoding.UTF8, "application/json")
                };
            }

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{}", Encoding.UTF8, "application/json")
            };
        });

        using var httpClient = new HttpClient(handler);
        using var cloud = new CloudControlService(temp.Database, temp.Config, httpClient);

        SyncStatusDto? pushedStatus = null;
        cloud.StatusChanged += (s) => pushedStatus = s;

        // Use repository which calls InsertOutbox
        temp.Database.RegisterVehicle(new VehicleRequest
        {
            Plate = "AUTO-02",
            Driver = "Auto Driver",
            OperatorId = "op-1"
        });

        // Wait up to 3 seconds for debounced automatic push
        for (int i = 0; i < 60 && (!interceptedPost || pushedStatus == null); i++)
        {
            await Task.Delay(50);
        }

        Assert.True(interceptedPost);
        Assert.NotNull(pushedStatus);
    }

    [Fact]
    public async Task CloudControlService_TicketCorrections_OutboxAndSyncWorked()
    {
        using var temp = new TempDatabase();

        var ticket = temp.Database.Tickets.CreateTicket(new CreateTicketRequest
        {
            TruckNo = "TEST-CORR-1",
            Driver = "Test Driver",
            Material = "Stone",
            WeightKg = 15000,
            OperatorId = "mr",
            OperatorName = "MD. RAJU"
        });

        temp.Database.Tickets.CompleteTicket(new CompleteTicketRequest
        {
            TicketId = ticket.Id,
            WeightKg = 5000,
            OperatorId = "mr",
            OperatorName = "MD. RAJU"
        });

        temp.Database.Tickets.VoidTicket(new TicketReasonRequest
        {
            TicketId = ticket.Id,
            Reason = "Entered wrong material",
            OperatorId = "mr",
            OperatorName = "MD. RAJU"
        });

        // Verify outbox has an event for ticket_corrections
        using (var conn = temp.Database.OpenConnection())
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM outbox_events WHERE entity_type = 'ticket_corrections' AND status = 'pending';";
            var count = Convert.ToInt32(cmd.ExecuteScalar());
            Assert.True(count >= 1, "Expected pending outbox event for ticket_corrections");
        }

        var interceptedCorrectionPost = false;
        var handler = new MockSupabaseHandler((req) =>
        {
            if (req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("workstation_controls"))
            {
                var json = """
                    [
                        {
                            "workstation_id": "test-ws",
                            "organization_id": "test-org",
                            "license_active": true,
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

            if (req.Method == HttpMethod.Post && req.RequestUri!.AbsolutePath.Contains("ticket_corrections"))
            {
                interceptedCorrectionPost = true;
                return new HttpResponseMessage(HttpStatusCode.Created)
                {
                    Content = new StringContent("{}", Encoding.UTF8, "application/json")
                };
            }

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{}", Encoding.UTF8, "application/json")
            };
        });

        using var httpClient = new HttpClient(handler);
        using var cloud = new CloudControlService(temp.Database, temp.Config, httpClient);

        await cloud.SyncNowAsync();

        Assert.True(interceptedCorrectionPost, "Expected POST to ticket_corrections in Supabase");

        using (var conn = temp.Database.OpenConnection())
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM outbox_events WHERE entity_type = 'ticket_corrections' AND status = 'accepted';";
            var acceptedCount = Convert.ToInt32(cmd.ExecuteScalar());
            Assert.True(acceptedCount >= 1, "Expected accepted outbox event for ticket_corrections");
        }
    }

    [Fact]
    public async Task CloudControlService_FirstWeigh_RegistersVehicleAndSyncsToCloud()
    {
        using var temp = new TempDatabase();

        // Simulate First Weigh with a completely new truck that has never been registered
        var ticket = temp.Database.Tickets.CreateTicket(new CreateTicketRequest
        {
            TruckNo = "TEST-FIRSTWEIGH-99",
            Driver = "New Driver 99",
            Phone = "0199999999",
            Material = "Scrap Iron",
            Client = "BSRM",
            WeightKg = 12500,
            OperatorId = "mr",
            OperatorName = "MD. RAJU"
        });

        // Check that outbox has an event for 'vehicles'
        using (var conn = temp.Database.OpenConnection())
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM outbox_events WHERE entity_type = 'vehicles' AND status = 'pending';";
            var count = Convert.ToInt32(cmd.ExecuteScalar());
            Assert.True(count >= 1, "Expected pending outbox event for vehicles from first weigh registration");
        }

        var interceptedVehiclePost = false;
        var handler = new MockSupabaseHandler((req) =>
        {
            if (req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("workstation_controls"))
            {
                var json = """
                    [
                        {
                            "workstation_id": "test-ws",
                            "organization_id": "test-org",
                            "license_active": true,
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

            if (req.Method == HttpMethod.Post && req.RequestUri!.AbsolutePath.Contains("vehicles"))
            {
                interceptedVehiclePost = true;
                return new HttpResponseMessage(HttpStatusCode.Created)
                {
                    Content = new StringContent("{}", Encoding.UTF8, "application/json")
                };
            }

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{}", Encoding.UTF8, "application/json")
            };
        });

        using var httpClient = new HttpClient(handler);
        using var cloud = new CloudControlService(temp.Database, temp.Config, httpClient);

        await cloud.SyncNowAsync();

        Assert.True(interceptedVehiclePost, "Expected POST to vehicles in Supabase");
    }

    [Fact]
    public void SchemaV005_CreatesTicketWatermarkColumn()
    {
        using var temp = new TempDatabase();
        using var conn = temp.Database.OpenConnection();

        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT last_allocated_ticket_number FROM sync_cursors WHERE id = 'local';";
        var val = Convert.ToInt64(cmd.ExecuteScalar());
        Assert.Equal(0, val);
    }

    [Fact]
    public void PeekNextTicketNumber_RespectsWatermark()
    {
        using var temp = new TempDatabase();
        using var conn = temp.Database.OpenConnection();

        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "UPDATE sync_cursors SET last_allocated_ticket_number = 50 WHERE id = 'local';";
            cmd.ExecuteNonQuery();
        }

        Assert.Equal(51, temp.Database.PeekNextTicketNumber());
    }

    [Fact]
    public async Task SyncCloudTicketWatermark_AdvancesSequence()
    {
        using var temp = new TempDatabase();

        var handler = new MockSupabaseHandler((req) =>
        {
            if (req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("weigh_tickets"))
            {
                var json = """[{"ticket_number": 42}]""";
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json")
                };
            }

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("[]", Encoding.UTF8, "application/json")
            };
        });

        using var httpClient = new HttpClient(handler);
        using var cloud = new CloudControlService(temp.Database, temp.Config, httpClient);

        long notifiedWatermark = 0;
        cloud.TicketSequenceSynchronized += (w) => notifiedWatermark = w;

        var synced = await cloud.SyncCloudTicketWatermarkAsync("https://mock.supabase.co", "key", CancellationToken.None);

        Assert.True(synced);
        Assert.Equal(42, notifiedWatermark);
        Assert.Equal(43, temp.Database.PeekNextTicketNumber());
    }

    [Fact]
    public async Task OutboxConflict_RenumberAndRetry_AutoHeals()
    {
        using var temp = new TempDatabase();

        // Create local ticket #1
        var req = new CreateTicketRequest
        {
            TruckNo = "DHK-11-2222",
            WeightKg = 25000,
            OperatorId = "mr",
            OperatorName = "MD. RAJU",
            Direction = "IN"
        };
        var ticket = temp.Database.CreateTicket(req);
        Assert.Equal(1, ticket.Id);

        int postCount = 0;
        var handler = new MockSupabaseHandler((req) =>
        {
            if (req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("workstation_controls"))
            {
                var json = """[{"workstation_id": "test-ws", "license_active": true, "enable_cloud_sync": true}]""";
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json")
                };
            }

            if (req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("weigh_tickets"))
            {
                // Supabase already has ticket #1
                var json = """[{"ticket_number": 1}]""";
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json")
                };
            }

            if (req.Method == HttpMethod.Post && req.RequestUri!.AbsolutePath.Contains("weigh_tickets"))
            {
                postCount++;
                if (postCount == 1)
                {
                    // First attempt: simulate PostgreSQL 23505 duplicate key violation on idx_tickets_number
                    var conflictJson = """{"code":"23505","message":"duplicate key value violates unique constraint \"idx_tickets_number\""}""";
                    return new HttpResponseMessage(HttpStatusCode.Conflict)
                    {
                        Content = new StringContent(conflictJson, Encoding.UTF8, "application/json")
                    };
                }

                // Second attempt: succeeds with renumbered ticket
                return new HttpResponseMessage(HttpStatusCode.Created)
                {
                    Content = new StringContent("{}", Encoding.UTF8, "application/json")
                };
            }

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{}", Encoding.UTF8, "application/json")
            };
        });

        using var httpClient = new HttpClient(handler);
        using var cloud = new CloudControlService(temp.Database, temp.Config, httpClient);

        await cloud.SyncNowAsync();

        Assert.Equal(2, postCount);

        // Verify local ticket was renumbered to #2
        var updated = temp.Database.GetTicket(2);
        Assert.NotNull(updated);
        Assert.Equal(2, updated.Id);
        Assert.Equal("2", updated.TicketDisplayId);

        // Verify watermark updated to 2, next peek is 3
        Assert.Equal(3, temp.Database.PeekNextTicketNumber());
    }

    private sealed class MockSupabaseHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _handler;

        public MockSupabaseHandler(Func<HttpRequestMessage, HttpResponseMessage> handler)
        {
            _handler = handler;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            return Task.FromResult(_handler(request));
        }
    }
}
