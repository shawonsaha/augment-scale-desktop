using System.Globalization;
using AugmentScale.Models.Commands;
using AugmentScale.Services;
using Xunit;

namespace AugmentScale.Tests;

public sealed class TempDatabase : IDisposable
{
    public TempDatabase()
    {
        DataDirectory = Path.Combine(Path.GetTempPath(), "AugmentScaleTests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(DataDirectory);
        Config = new ConfigService(DataDirectory);
        Database = new DatabaseService(Config);
        Database.EnsureInitialized();
    }

    public string DataDirectory { get; }
    public ConfigService Config { get; }
    public DatabaseService Database { get; }

    public void Dispose()
    {
        try
        {
            Directory.Delete(DataDirectory, recursive: true);
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }
}

public class ConfigServiceTests
{
    [Fact]
    public void HashPin_VerifiesOnlyTheMatchingPin()
    {
        var hash = ConfigService.HashPin("4321");

        Assert.True(ConfigService.VerifyPin("4321", hash));
        Assert.False(ConfigService.VerifyPin("1234", hash));
        Assert.False(ConfigService.VerifyPin("4321", "not-a-hash"));
    }

    [Fact]
    public void AuthenticatePin_SeededOperator_Works()
    {
        using var temp = new TempDatabase();

        Assert.NotNull(temp.Database.AuthenticateOperator("mr", "1234"));
        Assert.Null(temp.Database.AuthenticateOperator("mr", "9999"));
        Assert.Null(temp.Database.AuthenticateOperator("unknown", "1234"));
    }

    [Fact]
    public void SetPin_ReplacesExistingPinHash()
    {
        using var temp = new TempDatabase();

        temp.Config.SetPin("mr", "4321");

        Assert.True(temp.Config.AuthenticatePin("mr", "4321"));
        Assert.False(temp.Config.AuthenticatePin("mr", "1234"));
    }

    [Theory]
    [InlineData("123")]
    [InlineData("12345")]
    [InlineData("12a4")]
    [InlineData("12 4")]
    public void SetPin_RejectsPinsThatAreNotExactlyFourDigits(string pin)
    {
        using var temp = new TempDatabase();

        var error = Assert.Throws<InvalidOperationException>(() => temp.Config.SetPin("mr", pin));

        Assert.Equal("PIN must be exactly 4 digits.", error.Message);
    }

    [Fact]
    public void MissingSecrets_WithExistingDatabase_RefusesToCreateNewKey()
    {
        using var temp = new TempDatabase();
        File.Delete(temp.Config.SecretsPath);
        var freshConfig = new ConfigService(temp.DataDirectory);

        var error = Assert.Throws<InvalidOperationException>(() => _ = freshConfig.Secrets);

        Assert.Contains("existing database", error.Message, StringComparison.OrdinalIgnoreCase);
    }
}

public class DatabaseServiceTests
{
    private static CreateTicketRequest NewTicket(string plate, double weight = 12000) => new()
    {
        TruckNo = plate,
        Driver = "Test Driver",
        Phone = "+880 1700 000000",
        Material = "Scrap Iron",
        Client = "Test Client",
        Direction = "IN",
        WeightKg = weight,
        OperatorId = "mr",
        OperatorName = "MD. RAJU",
        RecordFirstPrint = true,
    };

    [Fact]
    public void Initialization_SeedsOperatorsVehiclesAndTicketNumber()
    {
        using var temp = new TempDatabase();

        Assert.Equal(5, temp.Database.GetOperators().Count);
        Assert.Equal(5, temp.Database.GetVehicles().Count);
        Assert.Equal(11353, temp.Database.PeekNextTicketNumber());
        Assert.All(temp.Database.GetOperators(), op => Assert.True(op.PinSet));
    }

    private static ProfileWriteRequest NewProfile(string code = "TST", string pin = "2468") => new()
    {
        DisplayName = "TEST OPERATOR",
        FirstName = "Test",
        Code = code,
        Role = "Operator",
        Shift = "Shift B",
        Avatar = "avatars/frame-3.svg",
        Color = "#475569",
        Pin = pin,
    };

    [Fact]
    public void Profile_CreateUpdateAndDeactivate_PersistAcrossRestart()
    {
        using var temp = new TempDatabase();

        var created = temp.Database.CreateProfile(NewProfile(), "mr", "MD. RAJU");
        Assert.True(temp.Config.AuthenticatePin(created.Id, "2468"));
        Assert.Contains(temp.Database.GetOperators(), op => op.Id == created.Id);

        var updated = temp.Database.UpdateProfile(new ProfileWriteRequest
        {
            Id = created.Id,
            DisplayName = "TEST OPERATOR UPDATED",
            FirstName = "Updated",
            Code = "TS2",
            Role = "Senior Operator",
            Shift = "Shift C",
            Avatar = "avatars/frame-5.svg",
            Color = "#526E7E",
        }, "mr", "MD. RAJU");
        Assert.Equal("TS2", updated.Code);

        var restarted = new DatabaseService(temp.Config);
        var persisted = restarted.GetOperators().Single(op => op.Id == created.Id);
        Assert.Equal("TEST OPERATOR UPDATED", persisted.Name);
        Assert.Equal("Senior Operator", persisted.Role);
        Assert.Equal("TS2", persisted.Code);

        Assert.True(temp.Database.DeactivateProfile(new DeactivateProfileRequest
        {
            ProfileId = created.Id,
            Reason = "Test cleanup",
        }, "mr", "MD. RAJU"));

        Assert.DoesNotContain(temp.Database.GetOperators(), op => op.Id == created.Id);
        Assert.Null(temp.Database.AuthenticateOperator(created.Id, "2468"));
        Assert.False(temp.Config.HasPin(created.Id));

        var restartedAgain = new DatabaseService(temp.Config);
        Assert.DoesNotContain(restartedAgain.GetOperators(), op => op.Id == created.Id);
    }

    [Fact]
    public void Profile_DeactivatedSeededProfileIsNotRestoredFromSetup()
    {
        using var temp = new TempDatabase();

        Assert.True(temp.Database.DeactivateProfile(new DeactivateProfileRequest
        {
            ProfileId = "sh",
            Reason = "Left the company",
        }, "mr", "MD. RAJU"));

        Assert.DoesNotContain(temp.Database.GetOperators(), op => op.Id == "sh");
        Assert.False(temp.Config.HasPin("sh"));

        var restarted = new DatabaseService(temp.Config);
        Assert.DoesNotContain(restarted.GetOperators(), op => op.Id == "sh");
    }

    [Fact]
    public void Profile_GuardsDuplicateCodeSelfRemovalAndLastSupervisor()
    {
        using var temp = new TempDatabase();

        Assert.Throws<InvalidOperationException>(
            () => temp.Database.CreateProfile(NewProfile("MR"), "mr", "MD. RAJU"));

        var created = temp.Database.CreateProfile(NewProfile(), "mr", "MD. RAJU");
        Assert.Throws<InvalidOperationException>(() => temp.Database.DeactivateProfile(
            new DeactivateProfileRequest { ProfileId = created.Id, Reason = "Self" },
            created.Id, "TEST OPERATOR"));

        Assert.Throws<InvalidOperationException>(() => temp.Database.DeactivateProfile(
            new DeactivateProfileRequest { ProfileId = "mr", Reason = "Last supervisor" },
            "ak", "AKHTER K."));

        Assert.Throws<InvalidOperationException>(() => temp.Database.UpdateProfile(new ProfileWriteRequest
        {
            Id = "mr",
            DisplayName = "MD. RAJU",
            FirstName = "Raju",
            Code = "MR",
            Role = "Operator",
            Shift = "Shift A",
            Avatar = "avatars/frame-9.svg",
            Color = "#4C7875",
        }, "mr", "MD. RAJU"));
    }

    [Fact]
    public void Profile_PinChangeAndSupervisorAuthentication()
    {
        using var temp = new TempDatabase();

        Assert.NotNull(temp.Database.AuthenticateSupervisor("mr", "1234"));
        Assert.Null(temp.Database.AuthenticateSupervisor("sh", "1234"));
        Assert.Null(temp.Database.AuthenticateSupervisor("mr", "9999"));

        Assert.True(temp.Database.SetProfilePin(new SetProfilePinRequest
        {
            ProfileId = "mr",
            Pin = "4321",
        }, "mr", "MD. RAJU"));

        Assert.True(temp.Config.AuthenticatePin("mr", "4321"));
        Assert.False(temp.Config.AuthenticatePin("mr", "1234"));
        Assert.Throws<InvalidOperationException>(() => temp.Database.SetProfilePin(
            new SetProfilePinRequest { ProfileId = "mr", Pin = "12" },
            "mr", "MD. RAJU"));
    }

    [Fact]
    public void CreateTicket_ParsesWebUiFirstTime()
    {
        using var temp = new TempDatabase();
        var request = NewTicket("TEST-TIME");
        request.FirstTime = "13-10-26 09:14:00 AM";

        var ticket = temp.Database.CreateTicket(request);

        Assert.Equal("13-10-26 09:14:00 AM", ticket.FirstWeightTime);
        Assert.StartsWith("2026-10-13T09:14:00", ticket.CreatedAt);
    }

    [Fact]
    public void CreateTicket_NewPlate_AutoRegistersVehicle()
    {
        using var temp = new TempDatabase();
        var request = NewTicket("TEST-AUTO-NEW");
        request.Driver = "Auto Driver";
        request.Phone = "+880 1700 111222";
        request.Client = "Auto Client";
        request.Material = "Auto Material";

        temp.Database.CreateTicket(request);

        var vehicle = temp.Database.GetVehicles().Single(v => v.Plate == "TEST-AUTO-NEW");
        Assert.Equal("Auto Driver", vehicle.Driver);
        Assert.Equal("+880 1700 111222", vehicle.Phone);
        Assert.Equal("Auto Client", vehicle.Client);
        Assert.Equal("Auto Material", vehicle.Material);
        Assert.Equal("active", vehicle.Status);
    }

    [Fact]
    public void CreateTicket_ExistingVehicle_UpdatesDefaults()
    {
        using var temp = new TempDatabase();
        var request = NewTicket("DM-T-11-2045");
        request.Driver = "Updated Driver";
        request.Phone = "+880 1700 333444";
        request.Client = "Updated Client";
        request.Material = "Updated Material";

        temp.Database.CreateTicket(request);

        var vehicle = temp.Database.GetVehicles().Single(v => v.Plate == "DM-T-11-2045");
        Assert.Equal("Updated Driver", vehicle.Driver);
        Assert.Equal("+880 1700 333444", vehicle.Phone);
        Assert.Equal("Updated Client", vehicle.Client);
        Assert.Equal("Updated Material", vehicle.Material);
        Assert.Equal(5, temp.Database.GetVehicles().Count);
    }

    [Fact]
    public void TicketLifecycle_CreateCompleteReprintVoid()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;

        var ticket = db.CreateTicket(NewTicket("TEST-001", 12000));

        Assert.Equal(11353, ticket.Id);
        Assert.Equal("pending", ticket.Status);
        Assert.Equal(12000, ticket.FirstWeight);
        Assert.Single(db.GetPendingTickets());
        Assert.Equal(1, ticket.PrintCount);

        Assert.Throws<InvalidOperationException>(() => db.CreateTicket(NewTicket("TEST-001")));

        var completed = db.CompleteTicket(new CompleteTicketRequest
        {
            TicketId = ticket.Id,
            WeightKg = 5000,
            OperatorId = "mr",
            OperatorName = "MD. RAJU",
            RecordCertificatePrint = true,
        });

        Assert.Equal("completed", completed.Status);
        Assert.Equal(12000, completed.GrossWeight);
        Assert.Equal(5000, completed.TareWeight);
        Assert.Equal(7000, completed.NetWeight);
        Assert.Empty(db.GetPendingTickets());
        Assert.Contains(db.GetHistory(), t => t.Id == ticket.Id && t.Status == "completed");

        var (reprinted, copyNumber) = db.RecordReprint(new ReprintRequest
        {
            TicketId = ticket.Id,
            Reason = "Customer copy",
            OperatorId = "mr",
        });

        Assert.Equal(2, copyNumber);
        Assert.Equal(ticket.Id, reprinted.Id);
        Assert.Contains(reprinted.PrintLog, p => p.CopyNumber == 2 && p.Reason == "Customer copy");

        var voided = db.VoidTicket(new TicketReasonRequest
        {
            TicketId = ticket.Id,
            Reason = "Wrong weight captured",
            OperatorId = "mr",
        });

        Assert.Equal("voided", voided.Status);
        Assert.Equal("Wrong weight captured", voided.VoidedReason);
        Assert.Throws<InvalidOperationException>(() => db.VoidTicket(new TicketReasonRequest
        {
            TicketId = ticket.Id,
            Reason = "Again",
            OperatorId = "mr",
        }));

        Assert.True(db.GetSyncStatus().PendingQueue > 0);
    }

    [Fact]
    public void TicketLifecycle_DeletePendingThenRecreateIncrementsNumber()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;

        var first = db.CreateTicket(NewTicket("TEST-002"));
        var deleted = db.SoftDeleteTicket(new TicketReasonRequest
        {
            TicketId = first.Id,
            Reason = "Duplicate entry",
            OperatorId = "mr",
        });

        Assert.True(deleted.Deleted);
        Assert.Empty(db.GetPendingTickets());

        var second = db.CreateTicket(NewTicket("TEST-002", 9000));
        Assert.Equal(11354, second.Id);
        Assert.Single(db.GetPendingTickets());
    }

    [Fact]
    public void VehicleArchive_BlockedByOpenTicket_ThenAllowedAfterDelete()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;
        var ticket = db.CreateTicket(NewTicket("DM-T-11-2045"));

        var blocked = db.ArchiveVehicle(new ArchiveVehicleRequest
        {
            Plate = "DM-T-11-2045",
            Reason = "Retired",
            OperatorId = "mr",
        });

        Assert.False(blocked.Ok);
        Assert.Contains("open ticket", blocked.Error);

        db.SoftDeleteTicket(new TicketReasonRequest
        {
            TicketId = ticket.Id,
            Reason = "Test cleanup",
            OperatorId = "mr",
        });

        var archived = db.ArchiveVehicle(new ArchiveVehicleRequest
        {
            Plate = "DM-T-11-2045",
            Reason = "Retired",
            OperatorId = "mr",
        });

        Assert.True(archived.Ok);
        Assert.Equal("archived", archived.Vehicle!.Status);

        var restored = db.RestoreVehicle(new ArchiveVehicleRequest
        {
            Plate = "DM-T-11-2045",
            Reason = "Returned to service",
            OperatorId = "mr",
        });

        Assert.NotNull(restored);
        Assert.Equal("active", restored!.Status);
    }

    [Fact]
    public void VehicleDelete_RequiresArchiveAndPreservesTicketHistory()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;
        var active = db.GetVehicles().First(v => v.Plate == "DM-T-11-2045");

        var unarchived = db.DeleteVehicle(new DeleteVehicleRequest
        {
            Plate = active.Plate,
            Reason = "Duplicate record",
            OperatorId = "mr",
        });
        Assert.False(unarchived.Ok);
        Assert.Contains("archived", unarchived.Error);

        var ticket = db.CreateTicket(NewTicket(active.Plate));
        var completed = db.CompleteTicket(new CompleteTicketRequest
        {
            TicketId = ticket.Id,
            WeightKg = 9000,
            OperatorId = "mr",
        });
        Assert.Equal(3000, completed.NetWeight);

        var archived = db.ArchiveVehicle(new ArchiveVehicleRequest
        {
            Plate = active.Plate,
            Reason = "Retired",
            OperatorId = "mr",
        });
        Assert.True(archived.Ok);

        var deleted = db.DeleteVehicle(new DeleteVehicleRequest
        {
            Plate = active.Plate,
            Reason = "Permanently removed",
            OperatorId = "mr",
        });

        Assert.True(deleted.Ok);
        Assert.DoesNotContain(db.GetVehicles(), v => v.Plate == active.Plate);
        Assert.Contains(db.GetHistory(), t => t.Id == ticket.Id);

        using var connection = db.OpenConnection();
        using (var ticketCmd = connection.CreateCommand())
        {
            ticketCmd.CommandText = "SELECT vehicle_id FROM weigh_tickets WHERE id = $id;";
            ticketCmd.Parameters.AddWithValue("$id", ticket.TicketUuid);
            using var reader = ticketCmd.ExecuteReader();
            Assert.True(reader.Read());
            Assert.True(reader.IsDBNull(0));
        }

        using var auditCmd = connection.CreateCommand();
        auditCmd.CommandText = """
            SELECT actor_user_id, actor_display_name, change_reason
            FROM audit_events
            WHERE entity_type = 'vehicles' AND entity_id = $id AND action = 'hard_delete';
            """;
        auditCmd.Parameters.AddWithValue("$id", active.Id);
        using var audit = auditCmd.ExecuteReader();
        Assert.True(audit.Read());
        Assert.Equal("mr", audit.GetString(0));
        Assert.Equal("MD. RAJU", audit.GetString(1));
        Assert.Equal("Permanently removed", audit.GetString(2));
    }

    [Fact]
    public void CompleteTicket_AnomalousNet_RequiresOverride()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;
        var ticket = db.CreateTicket(NewTicket("TEST-003", 3000));

        Assert.Throws<InvalidOperationException>(() => db.CompleteTicket(new CompleteTicketRequest
        {
            TicketId = ticket.Id,
            WeightKg = 5000,
            OperatorId = "mr",
        }));

        var completed = db.CompleteTicket(new CompleteTicketRequest
        {
            TicketId = ticket.Id,
            WeightKg = 5000,
            OperatorId = "mr",
            Override = new OverrideRequest
            {
                Reason = "Tare heavier than gross",
                Operator = "MD. RAJU",
            },
        });

        Assert.Equal(-2000, completed.NetWeight);
        Assert.True(completed.Override is not null);

        using var connection = db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT override_operator_id, override_operator_name
            FROM weigh_tickets WHERE id = $id;
            """;
        command.Parameters.AddWithValue("$id", completed.TicketUuid!);
        using var reader = command.ExecuteReader();
        Assert.True(reader.Read());
        Assert.Equal("mr", reader.GetString(0));
        Assert.Equal("MD. RAJU", reader.GetString(1));
    }

    private static string DateValue(DateTime value) => value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static int CountReportAudits(DatabaseService db)
    {
        using var connection = db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT COUNT(*) FROM audit_events
            WHERE entity_type = 'history_report' AND action = 'generate';
            """;
        return Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    private static HistoryReportRequest TodayReportRequest(string pin = "1234") => new()
    {
        FromDate = DateValue(DateTime.Now),
        ToDate = DateValue(DateTime.Now),
        OperatorId = "mr",
        Pin = pin,
    };

    [Fact]
    public void HistoryReport_RejectsWrongPinWithoutAuditAndHashesSuccessfulSnapshot()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;
        var ticket = db.CreateTicket(NewTicket("TEST-REPORT", 18000));
        var completed = db.CompleteTicket(new CompleteTicketRequest
        {
            TicketId = ticket.Id,
            WeightKg = 6000,
            OperatorId = "mr",
        });
        db.RecordReprint(new ReprintRequest
        {
            TicketId = ticket.Id,
            Reason = "Customer copy",
            OperatorId = "mr",
        });

        Assert.Throws<InvalidOperationException>(() =>
            db.GenerateHistoryReport(TodayReportRequest("9999")));
        Assert.Equal(0, CountReportAudits(db));

        var report = db.GenerateHistoryReport(TodayReportRequest());

        Assert.Contains(report.Tickets, t => t.Id == completed.Id && t.Status == "completed");
        Assert.Equal(1, report.Summary.Completed);
        Assert.Equal(1, report.Summary.Reprints);
        Assert.Equal(12000, report.Summary.NetKg);
        Assert.Equal(64, report.IntegrityHash.Length);
        Assert.Equal(DateTime.Now.ToString("dd MMM yyyy", CultureInfo.InvariantCulture), report.RangeLabel);
        Assert.Equal("MD. RAJU", report.OperatorName);
        Assert.Equal(1, CountReportAudits(db));

        using var connection = db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT after_values FROM audit_events
            WHERE entity_type = 'history_report' AND entity_id = $id;
            """;
        command.Parameters.AddWithValue("$id", report.ReportId);
        var auditPayload = Convert.ToString(command.ExecuteScalar(), CultureInfo.InvariantCulture) ?? "";
        Assert.Contains(report.ReportId, auditPayload);
        Assert.Contains(report.IntegrityHash, auditPayload);
        Assert.Contains("canonicalJson", auditPayload);
        Assert.DoesNotContain("1234", auditPayload);
    }

    [Fact]
    public void HistoryReport_IncludesEveryStatusInChronologicalOrder()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;

        var pending = db.CreateTicket(NewTicket("TEST-RPT-PENDING", 1000));

        var completedTicket = db.CreateTicket(NewTicket("TEST-RPT-COMPLETE", 18000));
        db.CompleteTicket(new CompleteTicketRequest
        {
            TicketId = completedTicket.Id,
            WeightKg = 7000,
            OperatorId = "mr",
        });

        var voidTicket = db.CreateTicket(NewTicket("TEST-RPT-VOID", 15000));
        db.CompleteTicket(new CompleteTicketRequest
        {
            TicketId = voidTicket.Id,
            WeightKg = 5000,
            OperatorId = "mr",
        });
        db.VoidTicket(new TicketReasonRequest
        {
            TicketId = voidTicket.Id,
            Reason = "Wrong vehicle",
            OperatorId = "mr",
        });

        var deleted = db.CreateTicket(NewTicket("TEST-RPT-DELETE", 12000));
        db.SoftDeleteTicket(new TicketReasonRequest
        {
            TicketId = deleted.Id,
            Reason = "Duplicate",
            OperatorId = "mr",
        });

        var report = db.GenerateHistoryReport(TodayReportRequest());

        Assert.Equal(4, report.Tickets.Count);
        Assert.Equal(4, report.Summary.Total);
        Assert.Equal(1, report.Summary.Completed);
        Assert.Equal(1, report.Summary.Pending);
        Assert.Equal(1, report.Summary.Voided);
        Assert.Equal(1, report.Summary.Deleted);
        Assert.Contains(report.Tickets, t => t.Id == pending.Id && t.Status == "pending");
        Assert.Contains(report.Tickets, t => t.Id == voidTicket.Id && t.Status == "voided");
        Assert.Contains(report.Tickets, t => t.Id == deleted.Id && t.Status == "deleted");

        var timestamps = report.Tickets
            .Select(t => DateTimeOffset.Parse(t.BusinessAt!, CultureInfo.InvariantCulture))
            .ToList();
        Assert.Equal(timestamps.OrderBy(value => value), timestamps);
    }

    [Fact]
    public void HistoryReport_UsesInclusiveLocalDateRange()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;
        var yesterday = DateTime.Now.AddDays(-1);

        var request = NewTicket("TEST-RPT-YESTERDAY", 11000);
        request.FirstTime = yesterday.ToString("dd-MM-yy hh:mm:ss tt", CultureInfo.InvariantCulture);
        var oldTicket = db.CreateTicket(request);

        var todayReport = db.GenerateHistoryReport(TodayReportRequest());
        Assert.DoesNotContain(todayReport.Tickets, t => t.Id == oldTicket.Id);

        var yesterdayRequest = TodayReportRequest();
        yesterdayRequest.FromDate = DateValue(yesterday);
        yesterdayRequest.ToDate = DateValue(yesterday);
        var yesterdayReport = db.GenerateHistoryReport(yesterdayRequest);

        Assert.Contains(yesterdayReport.Tickets, t => t.Id == oldTicket.Id);
        Assert.DoesNotContain(todayReport.Tickets, t => t.Id == oldTicket.Id);
    }

    [Fact]
    public void HistoryReport_VerificationMatchesArchivedSnapshot()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;
        var ticket = db.CreateTicket(NewTicket("TEST-RPT-VERIFY", 15000));
        db.CompleteTicket(new CompleteTicketRequest
        {
            TicketId = ticket.Id,
            WeightKg = 5000,
            OperatorId = "mr",
        });

        var report = db.GenerateHistoryReport(TodayReportRequest());
        var result = db.VerifyHistoryReport(new VerifyHistoryReportRequest
        {
            ReportId = report.ReportId,
            IntegrityHash = report.IntegrityHash,
        });

        Assert.True(result.Matched);
        Assert.Equal(report.IntegrityHash, result.ComputedHash);
        Assert.Equal(report.IntegrityHash, result.StoredHash);
        Assert.Equal("MD. RAJU", result.OperatorName);
        Assert.Contains("matches", result.Message);
    }

    [Fact]
    public void HistoryReport_VerificationRejectsWrongHashAndTamperedSnapshot()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;
        db.CreateTicket(NewTicket("TEST-RPT-TAMPER", 12000));
        var report = db.GenerateHistoryReport(TodayReportRequest());

        var wrongHash = db.VerifyHistoryReport(new VerifyHistoryReportRequest
        {
            ReportId = report.ReportId,
            IntegrityHash = new string('0', 64),
        });
        Assert.False(wrongHash.Matched);
        Assert.Contains("does not match", wrongHash.Message);

        using (var connection = db.OpenConnection())
        using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                UPDATE audit_events
                SET after_values = replace(after_values, '"canonicalJson":"', '"canonicalJson":"x')
                WHERE entity_type = 'history_report' AND entity_id = $id;
                """;
            command.Parameters.AddWithValue("$id", report.ReportId);
            Assert.Equal(1, command.ExecuteNonQuery());
        }

        var tampered = db.VerifyHistoryReport(new VerifyHistoryReportRequest
        {
            ReportId = report.ReportId,
            IntegrityHash = report.IntegrityHash,
        });
        Assert.False(tampered.Matched);
        Assert.Contains("does not match its recorded hash", tampered.Message);
    }

    [Fact]
    public void GetBootState_ReturnsEverythingForTheShell()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;

        var ticket = db.CreateTicket(NewTicket("DM-T-11-2045", 14000));
        var completed = db.CompleteTicket(new CompleteTicketRequest
        {
            TicketId = ticket.Id,
            WeightKg = 5000,
            OperatorId = "mr",
        });
        // Reuses the seeded plate so no extra vehicle is auto-registered.
        db.CreateTicket(NewTicket("DM-T-11-2045", 8000));

        var boot = db.GetBootState();

        Assert.Equal(5, boot.Operators.Count);
        Assert.Equal(5, boot.Vehicles.Count);
        Assert.Single(boot.Pending);
        Assert.Contains(boot.History, t => t.Id == completed.Id && t.Status == "completed");
        Assert.DoesNotContain(boot.History, t => t.Status == "pending");
        Assert.NotNull(boot.Sync);
        Assert.Equal(11355, boot.NextTicketNumber);
    }

    [Fact]
    public void GetBootState_ExcludesClosedHistoryBeforeToday()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;

        var ticket = db.CreateTicket(NewTicket("TEST-BOOT-OLD", 14000));
        var completed = db.CompleteTicket(new CompleteTicketRequest
        {
            TicketId = ticket.Id,
            WeightKg = 5000,
            OperatorId = "mr",
        });

        using (var connection = db.OpenConnection())
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = "UPDATE weigh_tickets SET completed_at = $at WHERE ticket_number = $number;";
            cmd.Parameters.AddWithValue("$at", DateTimeOffset.Now.AddDays(-1).ToString("O"));
            cmd.Parameters.AddWithValue("$number", completed.Id);
            cmd.ExecuteNonQuery();
        }

        var boot = db.GetBootState();

        Assert.DoesNotContain(boot.History, t => t.Id == completed.Id);
        Assert.Contains(db.GetHistory(), t => t.Id == completed.Id);
    }

    [Fact]
    public void GetBootState_ExcludesArchivedVehicles()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;

        var archived = db.ArchiveVehicle(new ArchiveVehicleRequest
        {
            Plate = "DM-T-11-2045",
            Reason = "Retired",
            OperatorId = "mr",
        });
        Assert.True(archived.Ok);

        var boot = db.GetBootState();

        Assert.Equal(4, boot.Vehicles.Count);
        Assert.DoesNotContain(boot.Vehicles, v => v.Plate == "DM-T-11-2045");
        Assert.Equal(5, db.GetVehicles().Count);
        Assert.Equal(4, db.GetActiveVehicles().Count);
    }

    [Fact]
    public void GetHistory_RespectsExplicitLimit()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;

        var first = db.CreateTicket(NewTicket("TEST-LIM-1", 10000));
        db.CompleteTicket(new CompleteTicketRequest
        {
            TicketId = first.Id,
            WeightKg = 5000,
            OperatorId = "mr",
        });
        var second = db.CreateTicket(NewTicket("TEST-LIM-2", 20000));
        db.CompleteTicket(new CompleteTicketRequest
        {
            TicketId = second.Id,
            WeightKg = 5000,
            OperatorId = "mr",
        });
        var third = db.CreateTicket(NewTicket("TEST-LIM-3", 30000));
        db.CompleteTicket(new CompleteTicketRequest
        {
            TicketId = third.Id,
            WeightKg = 5000,
            OperatorId = "mr",
        });

        Assert.Equal(3, db.GetHistory().Count);
        var limited = db.GetHistory(2);
        Assert.Equal(2, limited.Count);
        // Serialized with camelCase naming policy in BridgeService; all three completed tickets exist.
        Assert.Equal(new[] { third.Id, second.Id }, limited.Select(t => t.Id).ToArray());
    }

    [Fact]
    public void HistoryPage_FiltersByDateRange()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;

        // business_at is the completion time for completed tickets and the
        // first-weigh time for pending ones — mirror the History UI semantics.
        var yesterday = DateTime.Now.AddDays(-1);
        var oldRequest = NewTicket("TEST-PAGE-OLD", 11000);
        oldRequest.FirstTime = yesterday.ToString("dd-MM-yy hh:mm:ss tt", CultureInfo.InvariantCulture);
        var oldTicket = db.CreateTicket(oldRequest);

        var todayRequest = NewTicket("TEST-PAGE-TODAY", 16000);
        var todayTicket = db.CreateTicket(todayRequest);

        var today = DateValue(DateTime.Now);
        var todayPage = db.HistoryPage(new HistoryPageRequest
        {
            FromDate = today,
            ToDate = today,
            PageSize = 10,
        });
        Assert.Contains(todayPage.Tickets, t => t.Id == todayTicket.Id);
        Assert.DoesNotContain(todayPage.Tickets, t => t.Id == oldTicket.Id);

        var yesterdayPage = db.HistoryPage(new HistoryPageRequest
        {
            FromDate = DateValue(yesterday),
            ToDate = DateValue(yesterday),
            PageSize = 10,
        });
        Assert.Contains(yesterdayPage.Tickets, t => t.Id == oldTicket.Id);
        Assert.DoesNotContain(yesterdayPage.Tickets, t => t.Id == todayTicket.Id);
    }

    [Fact]
    public void HistoryPage_FiltersSortsPagesAndSummarizes()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;

        var first = NewTicket("TEST-PAGE-1", 10000);
        first.Driver = "Alpha Driver";
        first.Material = "Scrap Iron";
        first.Client = "Alpha Client";
        var t1 = db.CreateTicket(first);
        db.CompleteTicket(new CompleteTicketRequest
        {
            TicketId = t1.Id,
            WeightKg = 5000,
            OperatorId = "mr",
        });

        var second = NewTicket("TEST-PAGE-2", 20000);
        second.Driver = "Bravo Driver";
        second.Material = "Sand";
        second.Client = "Bravo Client";
        var t2 = db.CreateTicket(second);
        db.CompleteTicket(new CompleteTicketRequest
        {
            TicketId = t2.Id,
            WeightKg = 5000,
            OperatorId = "mr",
        });

        var third = NewTicket("TEST-PAGE-3", 3000);
        third.Driver = "Alpha Driver";
        third.Material = "Scrap Iron";
        third.Client = "Alpha Client";
        var t3 = db.CreateTicket(third);

        var fourth = NewTicket("TEST-PAGE-4", 4000);
        fourth.Driver = "Charlie Driver";
        fourth.Material = "Sand";
        fourth.Client = "Charlie Client";
        var t4 = db.CreateTicket(fourth);
        db.SoftDeleteTicket(new TicketReasonRequest
        {
            TicketId = t4.Id,
            Reason = "test delete",
            OperatorId = "mr",
        });

        var today = DateValue(DateTime.Now);
        var page = db.HistoryPage(new HistoryPageRequest
        {
            FromDate = today,
            ToDate = today,
            Page = 0,
            PageSize = 2,
            SortKey = "id",
            SortDir = "asc",
            IncludeOptions = true,
        });

        Assert.Equal(4, page.Total);
        Assert.Equal(2, page.Tickets.Count);
        Assert.Equal(new[] { t1.Id, t2.Id }, page.Tickets.Select(t => t.Id).ToArray());
        Assert.Equal(20000, page.NetKg);

        var secondPage = db.HistoryPage(new HistoryPageRequest
        {
            FromDate = today,
            ToDate = today,
            Page = 1,
            PageSize = 2,
            SortKey = "id",
            SortDir = "asc",
        });
        Assert.Equal(new[] { t3.Id, t4.Id }, secondPage.Tickets.Select(t => t.Id).ToArray());
        Assert.Null(secondPage.Options);

        var completed = db.HistoryPage(new HistoryPageRequest
        {
            FromDate = today,
            ToDate = today,
            Statuses = ["completed"],
            PageSize = 10,
        });
        Assert.Equal(2, completed.Total);
        Assert.Equal(20000, completed.NetKg);
        Assert.All(completed.Tickets, ticket => Assert.Equal("completed", ticket.Status));

        var searched = db.HistoryPage(new HistoryPageRequest
        {
            FromDate = today,
            ToDate = today,
            Search = "page-2",
            PageSize = 10,
        });
        Assert.Single(searched.Tickets);
        Assert.Equal(t2.Id, searched.Tickets[0].Id);

        var byDriver = db.HistoryPage(new HistoryPageRequest
        {
            FromDate = today,
            ToDate = today,
            Drivers = ["Alpha Driver"],
            PageSize = 10,
        });
        Assert.Equal(2, byDriver.Total);

        var byNet = db.HistoryPage(new HistoryPageRequest
        {
            FromDate = today,
            ToDate = today,
            SortKey = "net",
            SortDir = "desc",
            PageSize = 10,
        });
        Assert.Equal(new[] { t2.Id, t1.Id, t4.Id, t3.Id },
            byNet.Tickets.Select(t => t.Id).ToArray());

        Assert.Contains("Alpha Driver", page.Options!.Drivers);
        Assert.Contains("Bravo Driver", page.Options.Drivers);
        Assert.Contains("Scrap Iron", page.Options.Materials);
        Assert.Contains("Alpha Client", page.Options.Clients);
        Assert.Contains("MD. RAJU", page.Options.Operators);
    }

    [Fact]
    public void HistoryPage_RejectsRangesLongerThanOneYear()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;
        var today = DateTime.Now;

        var error = Assert.Throws<InvalidOperationException>(() => db.HistoryPage(new HistoryPageRequest
        {
            FromDate = DateValue(today.AddDays(-367)),
            ToDate = DateValue(today),
        }));
        Assert.Contains("one year", error.Message, StringComparison.OrdinalIgnoreCase);

        Assert.Throws<InvalidOperationException>(() => db.HistoryPage(new HistoryPageRequest
        {
            FromDate = DateValue(today),
            ToDate = DateValue(today.AddDays(-1)),
        }));

        var allowed = db.HistoryPage(new HistoryPageRequest
        {
            FromDate = DateValue(today.AddDays(-365)),
            ToDate = DateValue(today),
        });
        Assert.Equal(0, allowed.Total);
    }

    [Fact]
    public void HistoryReport_RejectsRangeLongerThanOneYear()
    {
        using var temp = new TempDatabase();
        var request = TodayReportRequest();
        request.FromDate = DateValue(DateTime.Now.AddDays(-367));

        var error = Assert.Throws<InvalidOperationException>(() =>
            temp.Database.GenerateHistoryReport(request));
        Assert.Contains("one year", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void HistoryReport_VerificationReportsUnknownReport()
    {
        using var temp = new TempDatabase();
        var result = temp.Database.VerifyHistoryReport(new VerifyHistoryReportRequest
        {
            ReportId = "HR-UNKNOWN",
            IntegrityHash = new string('0', 64),
        });

        Assert.False(result.Matched);
        Assert.Contains("No archived snapshot", result.Message);
    }
}
