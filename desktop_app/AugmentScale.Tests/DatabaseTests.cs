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
    }
}
