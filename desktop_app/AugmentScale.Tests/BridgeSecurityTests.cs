using System.Text.Json;
using AugmentScale.Models;
using AugmentScale.Models.Commands;
using AugmentScale.Services;
using Xunit;

namespace AugmentScale.Tests;

public class BridgeSecurityTests
{
    private static JsonElement ToJsonElement(object obj)
    {
        var json = JsonSerializer.Serialize(obj);
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    [Fact]
    public async Task MutatingCommands_WithoutActiveSession_AreRejected()
    {
        using var temp = new TempDatabase();
        using var scale = new ScaleReaderService(temp.Config, temp.Database);
        var bridge = new BridgeService(temp.Database, scale);

        // 1. createTicket without session token must throw
        var createEx = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            bridge.DispatchAsync("createTicket", ToJsonElement(new CreateTicketRequest
            {
                TruckNo = "DHK-11-2233",
                Direction = "IN",
                WeightKg = 15000,
                Token = ""
            })));
        Assert.Contains("No active operator session", createEx.Message);

        // 2. completeTicket without session token must throw
        var completeEx = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            bridge.DispatchAsync("completeTicket", ToJsonElement(new CompleteTicketRequest
            {
                TicketId = 1,
                WeightKg = 5000,
                Token = ""
            })));
        Assert.Contains("No active operator session", completeEx.Message);

        // 3. voidTicket without session token must throw
        var voidEx = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            bridge.DispatchAsync("voidTicket", ToJsonElement(new TicketReasonRequest
            {
                TicketId = 1,
                Reason = "Unauthorized void attempt",
                Token = ""
            })));
        Assert.Contains("No active operator session", voidEx.Message);

        // 4. deleteTicket without session token must throw
        var deleteEx = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            bridge.DispatchAsync("deleteTicket", ToJsonElement(new TicketReasonRequest
            {
                TicketId = 1,
                Reason = "Unauthorized delete attempt",
                Token = ""
            })));
        Assert.Contains("No active operator session", deleteEx.Message);

        // 5. registerVehicle without session token must throw
        var regEx = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            bridge.DispatchAsync("registerVehicle", ToJsonElement(new VehicleRequest
            {
                Plate = "DHK-99-9999",
                Token = ""
            })));
        Assert.Contains("No active operator session", regEx.Message);

        // 6. archiveVehicle without session token must throw
        var archEx = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            bridge.DispatchAsync("archiveVehicle", ToJsonElement(new ArchiveVehicleRequest
            {
                Plate = "DHK-99-9999",
                Reason = "Unauthorized archive",
                Token = ""
            })));
        Assert.Contains("No active operator session", archEx.Message);

        // 7. restoreVehicle without session token must throw
        var restEx = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            bridge.DispatchAsync("restoreVehicle", ToJsonElement(new ArchiveVehicleRequest
            {
                Plate = "DHK-99-9999",
                Token = ""
            })));
        Assert.Contains("No active operator session", restEx.Message);

        // 8. deleteVehicle without session token must throw
        var delvEx = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            bridge.DispatchAsync("deleteVehicle", ToJsonElement(new DeleteVehicleRequest
            {
                Plate = "DHK-99-9999",
                Reason = "Unauthorized delete",
                Token = ""
            })));
        Assert.Contains("No active operator session", delvEx.Message);

        // 9. recordReprint without session token must throw
        var reprintEx = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            bridge.DispatchAsync("recordReprint", ToJsonElement(new ReprintRequest
            {
                TicketId = 1,
                Reason = "Unauthorized reprint",
                Token = ""
            })));
        Assert.Contains("No active operator session", reprintEx.Message);
    }

    [Fact]
    public async Task AuthenticatePin_WithValidPin_IssuesSessionToken()
    {
        using var temp = new TempDatabase();
        using var scale = new ScaleReaderService(temp.Config, temp.Database);
        var bridge = new BridgeService(temp.Database, scale);

        var result = await bridge.DispatchAsync("authenticatePin", ToJsonElement(new
        {
            operatorId = "mr",
            pin = "1234"
        }));

        Assert.NotNull(result);
        var profile = Assert.IsType<ProfileDto>(result);
        Assert.Equal("mr", profile.Id);
        Assert.False(string.IsNullOrWhiteSpace(profile.Token));
    }

    [Fact]
    public async Task MutatingCommand_WithValidSessionToken_SucceedsAndOverwritesForgedActor()
    {
        using var temp = new TempDatabase();
        using var scale = new ScaleReaderService(temp.Config, temp.Database);
        var bridge = new BridgeService(temp.Database, scale);

        // 1. Authenticate as 'mr' (MD. RAJU)
        var authResult = await bridge.DispatchAsync("authenticatePin", ToJsonElement(new
        {
            operatorId = "mr",
            pin = "1234"
        }));
        var profile = Assert.IsType<ProfileDto>(authResult);
        var token = profile.Token!;

        // 2. Dispatch createTicket with forged operatorId/operatorName in payload
        var createResult = await bridge.DispatchAsync("createTicket", ToJsonElement(new CreateTicketRequest
        {
            TruckNo = "DHK-11-2233",
            Direction = "IN",
            WeightKg = 15000,
            OperatorId = "forged-id",
            OperatorName = "Forged Operator Name",
            Token = token
        }));

        var ticket = Assert.IsType<TicketDto>(createResult);
        Assert.Equal("MD. RAJU", ticket.FirstOperator);

        // 3. Complete ticket with forged override operator
        var completeResult = await bridge.DispatchAsync("completeTicket", ToJsonElement(new CompleteTicketRequest
        {
            TicketId = ticket.Id,
            WeightKg = 5000,
            OperatorId = "forged-id-2",
            OperatorName = "Forged Operator 2",
            Override = new OverrideRequest
            {
                Reason = "Manual net override",
                Operator = "Forged Supervisor"
            },
            Token = token
        }));

        var completedTicket = Assert.IsType<TicketDto>(completeResult);
        Assert.Equal("MD. RAJU", completedTicket.SecondOperator);
        Assert.NotNull(completedTicket.Override);
        Assert.Equal("MD. RAJU", completedTicket.Override.Operator);
    }

    [Fact]
    public async Task SignOutOperator_RevokesSessionToken()
    {
        using var temp = new TempDatabase();
        using var scale = new ScaleReaderService(temp.Config, temp.Database);
        var bridge = new BridgeService(temp.Database, scale);

        // 1. Authenticate
        var authResult = await bridge.DispatchAsync("authenticatePin", ToJsonElement(new
        {
            operatorId = "mr",
            pin = "1234"
        }));
        var profile = Assert.IsType<ProfileDto>(authResult);
        var token = profile.Token!;

        // 2. Sign out
        var signOutResult = await bridge.DispatchAsync("signOutOperator", ToJsonElement(new { }));
        Assert.Equal(true, signOutResult);

        // 3. Previously valid token must now be rejected
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            bridge.DispatchAsync("createTicket", ToJsonElement(new CreateTicketRequest
            {
                TruckNo = "DHK-11-2233",
                Direction = "IN",
                WeightKg = 15000,
                Token = token
            })));
        Assert.Contains("No active operator session", ex.Message);
    }

    [Fact]
    public async Task ExpiredSessionToken_IsRejected()
    {
        using var temp = new TempDatabase();
        using var scale = new ScaleReaderService(temp.Config, temp.Database);
        var bridge = new BridgeService(temp.Database, scale)
        {
            OperatorSessionLifetime = TimeSpan.FromMilliseconds(5)
        };

        // 1. Authenticate
        var authResult = await bridge.DispatchAsync("authenticatePin", ToJsonElement(new
        {
            operatorId = "mr",
            pin = "1234"
        }));
        var profile = Assert.IsType<ProfileDto>(authResult);
        var token = profile.Token!;

        // 2. Wait for expiration
        await Task.Delay(25);

        // 3. Attempt mutation with expired token
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            bridge.DispatchAsync("createTicket", ToJsonElement(new CreateTicketRequest
            {
                TruckNo = "DHK-11-2233",
                Direction = "IN",
                WeightKg = 15000,
                Token = token
            })));
        Assert.Contains("No active operator session", ex.Message);
    }
}
