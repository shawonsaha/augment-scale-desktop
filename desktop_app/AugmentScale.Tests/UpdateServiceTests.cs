using AugmentScale.Models;
using AugmentScale.Services;
using Xunit;

namespace AugmentScale.Tests;

public sealed class UpdateServiceTests : IDisposable
{
    private readonly string _tempDir;
    private readonly ConfigService _config;

    public UpdateServiceTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "AugmentScale_UpdateTests_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_tempDir);
        _config = new ConfigService(_tempDir);
        _config.EnsureInitialized();
    }

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(_tempDir))
            {
                Directory.Delete(_tempDir, true);
            }
        }
        catch
        {
            // Best effort cleanup
        }
    }

    [Fact]
    public void DefaultUpdateUrl_ConstructsFromSupabaseUrl()
    {
        _config.SetCloudCredentials("https://example-project.supabase.co", "anon-key-123");

        var updateUrl = _config.UpdateUrl;

        Assert.Equal("https://example-project.supabase.co/storage/v1/object/authenticated/releases", updateUrl);
    }

    [Fact]
    public void PublicUpdateUrl_NormalizesToAuthenticatedEndpoint()
    {
        _config.SetCloudCredentials("https://example-project.supabase.co", "anon-key-123");
        _config.Setup.Cloud.UpdateUrl = "https://example-project.supabase.co/storage/v1/object/public/releases";

        var updateUrl = _config.UpdateUrl;

        Assert.Equal("https://example-project.supabase.co/storage/v1/object/authenticated/releases", updateUrl);
    }

    [Fact]
    public void CustomUpdateUrl_OverridesDefaultSupabaseBucket()
    {
        _config.SetCloudCredentials("https://example-project.supabase.co", "anon-key-123");
        _config.Setup.Cloud.UpdateUrl = "https://cdn.augmentscale.com/updates";

        var updateUrl = _config.UpdateUrl;

        Assert.Equal("https://cdn.augmentscale.com/updates", updateUrl);
    }

    [Fact]
    public void UpdateService_InitializesWithSafeDefaults()
    {
        using var service = new UpdateService(_config);

        var status = service.GetUpdateStatus();

        Assert.NotNull(status);
        Assert.Equal("idle", status.Status);
        Assert.Equal("1.0.0", status.CurrentVersion);
        Assert.Null(status.TargetVersion);
        Assert.Equal(0, status.Progress);
        Assert.Null(status.Error);
        Assert.False(status.IsInstalled);
    }

    [Fact]
    public async Task CheckForUpdates_InDevMode_ReturnsNullSafely()
    {
        _config.SetCloudCredentials("https://example-project.supabase.co", "anon-key-123");
        using var service = new UpdateService(_config);

        var result = await service.CheckForUpdatesAsync(autoDownload: true);

        Assert.Null(result);
        var status = service.GetUpdateStatus();
        Assert.Equal("idle", status.Status);
    }

    [Fact]
    public void ApplyUpdatesAndRestart_WhenNoUpdatePending_ThrowsInvalidOperation()
    {
        using var service = new UpdateService(_config);

        var ex = Assert.Throws<InvalidOperationException>(() => service.ApplyUpdatesAndRestart());

        Assert.Contains("No update has been downloaded", ex.Message);
    }

    [Fact]
    public void SupabaseAuthenticatedFileDownloader_InitializesCleanly()
    {
        var downloader = new SupabaseAuthenticatedFileDownloader("test-key");
        Assert.NotNull(downloader);
    }

    [Fact]
    public void SetupConfig_DeserializesPublishableKeyAndApiKeyAliases()
    {
        var jsonWithPublishable = """
            {
                "cloud": {
                    "supabaseUrl": "https://example.supabase.co",
                    "supabasePublishableKey": "sb_publishable_1234567890"
                }
            }
            """;

        var options = new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        var config1 = System.Text.Json.JsonSerializer.Deserialize<SetupConfig>(jsonWithPublishable, options);
        Assert.NotNull(config1);
        Assert.Equal("sb_publishable_1234567890", config1.Cloud.SupabaseAnonKey);
        Assert.Equal("sb_publishable_1234567890", config1.Cloud.SupabasePublishableKey);

        var jsonWithApiKey = """
            {
                "cloud": {
                    "supabaseUrl": "https://example.supabase.co",
                    "supabaseApiKey": "sb_publishable_0987654321"
                }
            }
            """;

        var config2 = System.Text.Json.JsonSerializer.Deserialize<SetupConfig>(jsonWithApiKey, options);
        Assert.NotNull(config2);
        Assert.Equal("sb_publishable_0987654321", config2.Cloud.SupabaseAnonKey);
        Assert.Equal("sb_publishable_0987654321", config2.Cloud.SupabaseApiKey);
    }
}
