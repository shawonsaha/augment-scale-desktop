namespace AugmentScale.Models;

public sealed class SyncStatusDto
{
    public bool IsHealthy { get; set; } = true;
    public int PendingQueue { get; set; }
    public string LastSyncTimestamp { get; set; } = DateTimeOffset.Now.ToString("o");
    public int OutboxTotal { get; set; }
    public ArchiveStatusDto Archive { get; set; } = new();

    public string CloudStatus { get; set; } = "offline"; // "online", "syncing", "paused", "offline"
    public bool CloudSyncEnabled { get; set; } = true;
    public bool LicenseActive { get; set; } = true;
    public string? LastCloudSyncTimestamp { get; set; }
}
