using System.IO;
using System.Text.Json;
using AugmentScale.Models;
using Xunit;

namespace AugmentScale.Tests;

public class SetupConfigTests
{
    [Fact]
    public void DefaultSetupConfig_MatchesSetupJsonTemplate()
    {
        var fresh = new SetupConfig();
        var templatePath = Path.Combine(AppContext.BaseDirectory, "Resources", "setup.json");
        Assert.True(File.Exists(templatePath), $"setup.json template should exist at {templatePath}");

        var templateJson = File.ReadAllText(templatePath);
        var expected = JsonSerializer.Deserialize<SetupConfig>(templateJson, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = true,
        });

        Assert.NotNull(expected);

        // Organization
        Assert.Equal(expected.Organization.Name, fresh.Organization.Name);
        Assert.Equal(expected.Organization.Address, fresh.Organization.Address);
        Assert.Equal(expected.Organization.Phone, fresh.Organization.Phone);
        Assert.Equal(expected.Organization.Email, fresh.Organization.Email);

        // Site
        Assert.Equal(expected.Site.Name, fresh.Site.Name);
        Assert.Equal(expected.Site.Timezone, fresh.Site.Timezone);
        Assert.Equal(expected.Site.Address, fresh.Site.Address);

        // Weighbridge
        Assert.Equal(expected.Weighbridge.Name, fresh.Weighbridge.Name);
        Assert.Equal(expected.Weighbridge.MaxCapacityKg, fresh.Weighbridge.MaxCapacityKg);
        Assert.Equal(expected.Weighbridge.MinDivisionKg, fresh.Weighbridge.MinDivisionKg);

        // ScaleConnection
        Assert.Equal(expected.ScaleConnection.PortName, fresh.ScaleConnection.PortName);
        Assert.Equal(expected.ScaleConnection.BaudRate, fresh.ScaleConnection.BaudRate);
        Assert.Equal(expected.ScaleConnection.DataBits, fresh.ScaleConnection.DataBits);
        Assert.Equal(expected.ScaleConnection.Parity, fresh.ScaleConnection.Parity);
        Assert.Equal(expected.ScaleConnection.StopBits, fresh.ScaleConnection.StopBits);
        Assert.Equal(expected.ScaleConnection.ProtocolFormat, fresh.ScaleConnection.ProtocolFormat);
        Assert.Equal(expected.ScaleConnection.StabilityWindowMs, fresh.ScaleConnection.StabilityWindowMs);
        Assert.Equal(expected.ScaleConnection.StabilityToleranceKg, fresh.ScaleConnection.StabilityToleranceKg);

        // Cloud
        Assert.Equal(expected.Cloud.SupabaseUrl, fresh.Cloud.SupabaseUrl);
        Assert.Equal(expected.Cloud.SupabaseAnonKey, fresh.Cloud.SupabaseAnonKey);
        Assert.Equal(expected.Cloud.HeartbeatIntervalSeconds, fresh.Cloud.HeartbeatIntervalSeconds);
        Assert.Equal(expected.Cloud.LicenseGraceDays, fresh.Cloud.LicenseGraceDays);

        // Operators
        Assert.Equal(expected.Operators.Count, fresh.Operators.Count);
        for (var i = 0; i < expected.Operators.Count; i++)
        {
            Assert.Equal(expected.Operators[i].Id, fresh.Operators[i].Id);
            Assert.Equal(expected.Operators[i].Code, fresh.Operators[i].Code);
            Assert.Equal(expected.Operators[i].DisplayName, fresh.Operators[i].DisplayName);
            Assert.Equal(expected.Operators[i].FirstName, fresh.Operators[i].FirstName);
            Assert.Equal(expected.Operators[i].Role, fresh.Operators[i].Role);
            Assert.Equal(expected.Operators[i].Shift, fresh.Operators[i].Shift);
            Assert.Equal(expected.Operators[i].Avatar, fresh.Operators[i].Avatar);
            Assert.Equal(expected.Operators[i].Color, fresh.Operators[i].Color);
            Assert.Equal(expected.Operators[i].Pin, fresh.Operators[i].Pin);
        }
    }
}
