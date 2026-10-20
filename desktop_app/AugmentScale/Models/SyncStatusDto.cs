namespace AugmentScale.Models;

public sealed class SyncStatusDto
{
    public bool IsHealthy { get; set; } = true;
    public int PendingQueue { get; set; }
    public string LastSyncTimestamp { get; set; } = DateTimeOffset.Now.ToString("o");
    public int OutboxTotal { get; set; }
}
