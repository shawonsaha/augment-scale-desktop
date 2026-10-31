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

        // Verify audit event was logged with before and after numbers
        using (var conn = temp.Database.OpenConnection())
        using (var auditCmd = conn.CreateCommand())
        {
            auditCmd.CommandText = "SELECT action, actor_user_id, before_values, after_values FROM audit_events WHERE entity_id = $id AND action = 'ticket_number_change';";
            auditCmd.Parameters.AddWithValue("$id", ticket.TicketUuid);
            using var reader = auditCmd.ExecuteReader();
            Assert.True(reader.Read());
            Assert.Equal("ticket_number_change", reader.GetString(0));
            Assert.Equal("system", reader.GetString(1));
            Assert.Contains("\"ticket_number\":1", reader.GetString(2));
            Assert.Contains("\"ticket_number\":2", reader.GetString(3));
        }
    }

    [Fact]
    public async Task OutboxConflict_RenumberAndRetry_AllocatesFromAllThreeMaxima_AndLogsAudit()
    {
        using var temp = new TempDatabase();

        // 1. Create ticket #1 using CreateTicket
        var t1 = temp.Database.CreateTicket(new CreateTicketRequest
        {
            TruckNo = "DHK-120",
            WeightKg = 25000,
            OperatorId = "mr",
            OperatorName = "MD. RAJU",
            Direction = "IN"
        });

        // 2. Set watermark to 149 and renumber t1 to 120, then create ticket #150
        using (var conn = temp.Database.OpenConnection())
        using (var txn = conn.BeginTransaction())
        {
            using var wmCmd = conn.CreateCommand();
            wmCmd.Transaction = txn;
            wmCmd.CommandText = "UPDATE sync_cursors SET last_allocated_ticket_number = 149 WHERE id = 'local';";
            wmCmd.ExecuteNonQuery();

            using var updateT120 = conn.CreateCommand();
            updateT120.Transaction = txn;
            updateT120.CommandText = "UPDATE weigh_tickets SET ticket_number = 120, ticket_display_id = '120' WHERE id = $id;";
            updateT120.Parameters.AddWithValue("$id", t1.TicketUuid);
            updateT120.ExecuteNonQuery();

            using var updateOutbox = conn.CreateCommand();
            updateOutbox.Transaction = txn;
            updateOutbox.CommandText = "UPDATE outbox_events SET payload = '{\"ticket_number\":120,\"ticket_display_id\":\"120\"}' WHERE entity_id = $id;";
            updateOutbox.Parameters.AddWithValue("$id", t1.TicketUuid);
            updateOutbox.ExecuteNonQuery();

            txn.Commit();
        }

        // Creating t2 now allocates 150 because watermark was 149
        var t2 = temp.Database.CreateTicket(new CreateTicketRequest
        {
            TruckNo = "DHK-150",
            WeightKg = 30000,
            OperatorId = "mr",
            OperatorName = "MD. RAJU",
            Direction = "IN"
        });
        Assert.Equal(150, t2.Id);

        // Also delete outbox event for t2 so only t1 (with number 120) is pushed in this test
        using (var conn = temp.Database.OpenConnection())
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "DELETE FROM outbox_events WHERE entity_id = $id;";
            cmd.Parameters.AddWithValue("$id", t2.TicketUuid);
            cmd.ExecuteNonQuery();
        }

        int postCount = 0;
        long postedTicketNumber = 0;
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
                // Cloud max is 100
                var json = """[{"ticket_number": 100}]""";
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json")
                };
            }

            if (req.Method == HttpMethod.Post && req.RequestUri!.AbsolutePath.Contains("weigh_tickets"))
            {
                postCount++;
                var body = req.Content?.ReadAsStringAsync().GetAwaiter().GetResult() ?? "";
                if (postCount == 1)
                {
                    // First attempt: simulate PostgreSQL 23505 unique constraint violation
                    var conflictJson = """{"code":"23505","message":"duplicate key value violates unique constraint \"idx_tickets_number\""}""";
                    return new HttpResponseMessage(HttpStatusCode.Conflict)
                    {
                        Content = new StringContent(conflictJson, Encoding.UTF8, "application/json")
                    };
                }

                // Second attempt: capture posted ticket number and succeed
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("ticket_number", out var p))
                {
                    postedTicketNumber = p.GetInt64();
                }

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
        // Verified: posted ticket to cloud was #151 (NOT #121!)
        Assert.Equal(151, postedTicketNumber);

        // Verify local ticket was renumbered to #151
        var updated = temp.Database.GetTicket(151);
        Assert.NotNull(updated);
        Assert.Equal(151, updated.Id);
        Assert.Equal("151", updated.TicketDisplayId);

        // Verify watermark updated to 151, next peek is 152
        Assert.Equal(152, temp.Database.PeekNextTicketNumber());

        // Verify audit event exists
        using (var conn = temp.Database.OpenConnection())
        using (var auditCmd = conn.CreateCommand())
        {
            auditCmd.CommandText = "SELECT action, actor_user_id, before_values, after_values FROM audit_events WHERE entity_id = $id AND action = 'ticket_number_change';";
            auditCmd.Parameters.AddWithValue("$id", t1.TicketUuid);
            using var reader = auditCmd.ExecuteReader();
            Assert.True(reader.Read());
            Assert.Equal("ticket_number_change", reader.GetString(0));
            Assert.Equal("system", reader.GetString(1));
            Assert.Contains("\"ticket_number\":120", reader.GetString(2));
            Assert.Contains("\"ticket_number\":151", reader.GetString(3));
        }

        // Verify outbox status is accepted
        using (var conn = temp.Database.OpenConnection())
        using (var checkOutbox = conn.CreateCommand())
        {
            checkOutbox.CommandText = "SELECT status FROM outbox_events WHERE entity_id = $id;";
            checkOutbox.Parameters.AddWithValue("$id", t1.TicketUuid);
            Assert.Equal("accepted", checkOutbox.ExecuteScalar() as string);
        }
    }

    [Fact]
    public async Task OutboxFailure_WeighTickets_NeverDeadLetters_RemainsPendingAndUnhealthy()
    {
        using var temp = new TempDatabase();

        // Create a local ticket
        var ticket = temp.Database.CreateTicket(new CreateTicketRequest
        {
            TruckNo = "FAIL-99",
            WeightKg = 25000,
            OperatorId = "mr",
            OperatorName = "MD. RAJU",
            Direction = "IN"
        });

        // Set its outbox event attempts to 9, mark bootstrap complete, and isolate it as the only pending outbox event
        using (var conn = temp.Database.OpenConnection())
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                DELETE FROM outbox_events WHERE entity_id != $id;
                UPDATE outbox_events SET attempts = 9 WHERE entity_id = $id;
                UPDATE license_cache SET bootstrap_completed = 1 WHERE id = 'current';
                """;
            cmd.Parameters.AddWithValue("$id", ticket.TicketUuid);
            cmd.ExecuteNonQuery();
        }

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

            if (req.Method == HttpMethod.Post && req.RequestUri!.AbsolutePath.Contains("weigh_tickets"))
            {
                // Supabase returns 500 error
                return new HttpResponseMessage(HttpStatusCode.InternalServerError)
                {
                    Content = new StringContent("{\"error\":\"Internal database error\"}", Encoding.UTF8, "application/json")
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

        // Verify outbox row remains 'pending', attempts reached 10, NOT transitioned to 'dead_letter'
        using (var conn = temp.Database.OpenConnection())
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT status, attempts FROM outbox_events WHERE entity_id = $id;";
            cmd.Parameters.AddWithValue("$id", ticket.TicketUuid);
            using var reader = cmd.ExecuteReader();
            Assert.True(reader.Read());
            Assert.Equal("pending", reader.GetString(0));
            Assert.Equal(10, reader.GetInt32(1));
        }

        // Verify GetSyncStatus flags degradation: IsHealthy is false, PendingQueue is preserved
        var syncStatus = temp.Database.GetSyncStatus();
        Assert.False(syncStatus.IsHealthy);
        Assert.True(syncStatus.PendingQueue >= 1);
        Assert.Equal(0, syncStatus.DeadLetterQueue);
    }

    [Fact]
    public void CloudControlService_DynamicQueries_ThrowArgumentException_OnDisallowedTable()
    {
        using var temp = new TempDatabase();
        using var client = new HttpClient();
        using var cloud = new CloudControlService(temp.Database, temp.Config, client);

        // Disallowed table injection attempts
        Assert.Throws<ArgumentException>(() =>
            cloud.ReadAllRowsFromTable("weigh_tickets; DROP TABLE profiles;--"));

        Assert.Throws<ArgumentException>(() =>
            cloud.ReadRowById("sqlite_master; DROP TABLE weigh_tickets;--", "1"));

        Assert.Throws<ArgumentException>(() =>
            cloud.ReadRowById("invalid_table_name", "1"));

        // Allowed tables do not throw
        var rows = cloud.ReadAllRowsFromTable("vehicles");
        Assert.NotNull(rows);

        var row = cloud.ReadRowById("weigh_tickets", "non-existent-id");
        Assert.Null(row);
    }

    [Fact]
    public async Task CloudControlService_RejectsMaliciousOutboxEntityType()
    {
        using var temp = new TempDatabase();

        // Seed an outbox event with a malicious entity_type
        using (var conn = temp.Database.OpenConnection())
        using (var txn = conn.BeginTransaction())
        {
            using var cmd = conn.CreateCommand();
            cmd.Transaction = txn;
            cmd.CommandText = """
                INSERT INTO outbox_events (
                    id, sequence, entity_type, entity_id, operation, payload, workstation_id, operator_id, status, created_at
                ) VALUES (
                    'evt-malicious-1', 9999, 'vehicles; DROP TABLE weigh_tickets;--', 'veh-1', 'insert', '{"plateNumber":"TEST"}', 'ws-1', 'op-1', 'pending', datetime('now')
                );
                """;
            cmd.ExecuteNonQuery();
            txn.Commit();
        }

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

        await cloud.SyncNowAsync();

        // The malicious event must not execute SQL or succeed; it should be marked with error in outbox_events
        using (var conn = temp.Database.OpenConnection())
        {
            using var check = conn.CreateCommand();
            check.CommandText = "SELECT status, server_response FROM outbox_events WHERE id = 'evt-malicious-1';";
            using var reader = check.ExecuteReader();
            Assert.True(reader.Read());
            var status = reader.GetString(0);
            var serverResponse = reader.IsDBNull(1) ? null : reader.GetString(1);
            Assert.Equal("pending", status);
            Assert.NotNull(serverResponse);
            Assert.Contains("Disallowed or unrecognized entity type", serverResponse);

            // Verify weigh_tickets table still exists intact
            using var tableCheck = conn.CreateCommand();
            tableCheck.CommandText = "SELECT COUNT(*) FROM weigh_tickets;";
            var count = Convert.ToInt32(tableCheck.ExecuteScalar());
            Assert.True(count >= 0);
        }
    }

    [Fact]
    public void SchemaV006_AllowsDeadLetterStatusInCheckConstraint()
    {
        using var temp = new TempDatabase();
        using var conn = temp.Database.OpenConnection();

        // Verify version 6 is recorded in schema_version
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT COUNT(*) FROM schema_version WHERE version = 6;";
            var count = Convert.ToInt32(cmd.ExecuteScalar());
            Assert.Equal(1, count);
        }

        // Verify inserting an outbox row with 'dead_letter' status is permitted by the CHECK constraint
        using (var insert = conn.CreateCommand())
        {
            insert.CommandText = """
                INSERT INTO outbox_events (
                    id, sequence, entity_type, entity_id, operation, payload, workstation_id, operator_id, attempts, status, created_at
                ) VALUES (
                    'evt-dl-test', 99998, 'vehicles', 'veh-dl', 'insert', '{}', 'ws-1', 'op-1', 10, 'dead_letter', datetime('now')
                );
                """;
            insert.ExecuteNonQuery();
        }

        using (var query = conn.CreateCommand())
        {
            query.CommandText = "SELECT status FROM outbox_events WHERE id = 'evt-dl-test';";
            Assert.Equal("dead_letter", query.ExecuteScalar() as string);
        }
    }

    [Fact]
    public async Task CloudControlService_OutboxFailure_ReachesMaxAttempts_TransitionsToDeadLetter_AndUnblocksQueue()
    {
        using var temp = new TempDatabase();

        // Seed 2 outbox events:
        // Event 1 (sequence 1): failing vehicle, already attempted 9 times
        // Event 2 (sequence 2): valid vehicle, attempted 0 times
        using (var conn = temp.Database.OpenConnection())
        {
            using var txn = conn.BeginTransaction();
            using var cmd1 = conn.CreateCommand();
            cmd1.Transaction = txn;
            cmd1.CommandText = """
                INSERT INTO outbox_events (
                    id, sequence, entity_type, entity_id, operation, payload, workstation_id, operator_id, attempts, status, created_at
                ) VALUES (
                    'evt-fail-1', 1, 'vehicles', 'veh-fail-1', 'insert', '{"plateNumber":"FAIL-01"}', 'ws-1', 'op-1', 9, 'pending', datetime('now')
                );
                """;
            cmd1.ExecuteNonQuery();

            using var cmd2 = conn.CreateCommand();
            cmd2.Transaction = txn;
            cmd2.CommandText = """
                INSERT INTO outbox_events (
                    id, sequence, entity_type, entity_id, operation, payload, workstation_id, operator_id, attempts, status, created_at
                ) VALUES (
                    'evt-success-2', 2, 'vehicles', 'veh-succ-2', 'insert', '{"plateNumber":"SUCC-02"}', 'ws-1', 'op-1', 0, 'pending', datetime('now')
                );
                """;
            cmd2.ExecuteNonQuery();

            using var seedVeh = conn.CreateCommand();
            seedVeh.Transaction = txn;
            seedVeh.CommandText = """
                INSERT INTO vehicles (id, organization_id, plate_number, plate_normalized, created_at, updated_at)
                VALUES ('veh-fail-1', $org, 'FAIL-01', 'FAIL01', datetime('now'), datetime('now')),
                       ('veh-succ-2', $org, 'SUCC-02', 'SUCC02', datetime('now'), datetime('now'));
                """;
            seedVeh.Parameters.AddWithValue("$org", temp.Database.OrganizationId);
            seedVeh.ExecuteNonQuery();

            // Mark bootstrap completed so it streams outbox directly
            using var bootCmd = conn.CreateCommand();
            bootCmd.Transaction = txn;
            bootCmd.CommandText = "UPDATE license_cache SET bootstrap_completed = 1 WHERE id = 'current';";
            bootCmd.ExecuteNonQuery();

            txn.Commit();
        }

        var handler = new MockSupabaseHandler(req =>
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
                // Fail veh-fail-1 with 400 Bad Request
                var content = req.Content?.ReadAsStringAsync().GetAwaiter().GetResult() ?? "";
                if (content.Contains("FAIL-01"))
                {
                    return new HttpResponseMessage(HttpStatusCode.BadRequest)
                    {
                        Content = new StringContent("{\"error\":\"Invalid vehicle format\"}", Encoding.UTF8, "application/json")
                    };
                }

                // Succeed for valid vehicle
                return new HttpResponseMessage(HttpStatusCode.OK)
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

        using (var conn = temp.Database.OpenConnection())
        {
            // Verify event 1 transitioned to 'dead_letter' with 10 attempts
            using var check1 = conn.CreateCommand();
            check1.CommandText = "SELECT status, attempts, server_response FROM outbox_events WHERE id = 'evt-fail-1';";
            using var r1 = check1.ExecuteReader();
            Assert.True(r1.Read());
            Assert.Equal("dead_letter", r1.GetString(0));
            Assert.Equal(10, r1.GetInt32(1));
            Assert.Contains("Invalid vehicle format", r1.GetString(2));

            // Verify event 2 synced and is 'accepted' (proving the queue was NOT stalled by event 1!)
            using var check2 = conn.CreateCommand();
            check2.CommandText = "SELECT status, attempts FROM outbox_events WHERE id = 'evt-success-2';";
            using var r2 = check2.ExecuteReader();
            Assert.True(r2.Read());
            Assert.Equal("accepted", r2.GetString(0));
        }
    }

        [Fact]
        public void AddSupabaseHeaders_WithPublishableKey_SetsOnlyApiKeyHeader()
        {
            var request = new HttpRequestMessage(HttpMethod.Get, "https://example.supabase.co/rest/v1/workstation_controls");
            var publishableKey = "sb_publishable_T3J6isINyJ88kgJEkmv2-Q_NeEZY25t";

            CloudControlService.AddSupabaseHeaders(request, publishableKey);

            Assert.True(request.Headers.Contains("apikey"));
            Assert.Equal(publishableKey, request.Headers.GetValues("apikey").Single());
            Assert.Null(request.Headers.Authorization);
        }

        [Fact]
        public void AddSupabaseHeaders_WithLegacyJwtKey_SetsBothApiKeyAndAuthorization()
        {
            var request = new HttpRequestMessage(HttpMethod.Get, "https://example.supabase.co/rest/v1/workstation_controls");
            var jwtKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSJ9.signature";

            CloudControlService.AddSupabaseHeaders(request, jwtKey);

            Assert.True(request.Headers.Contains("apikey"));
            Assert.Equal(jwtKey, request.Headers.GetValues("apikey").Single());
            Assert.NotNull(request.Headers.Authorization);
            Assert.Equal("Bearer", request.Headers.Authorization!.Scheme);
            Assert.Equal(jwtKey, request.Headers.Authorization!.Parameter);
        }

        [Theory]
        [InlineData("sb_publishable_12345", false)]
        [InlineData("sb_secret_67890", false)]
        [InlineData("", false)]
        [InlineData(null, false)]
        [InlineData("not-a-jwt", false)]
        [InlineData("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSJ9.sig", true)]
        public void IsJwtToken_DifferentiatesOpaqueKeysFromJwt(string? key, bool expectedJwt)
        {
            Assert.Equal(expectedJwt, CloudControlService.IsJwtToken(key));
        }

    internal sealed class MockSupabaseHandler : HttpMessageHandler
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
