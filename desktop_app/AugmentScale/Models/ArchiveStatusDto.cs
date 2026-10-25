namespace AugmentScale.Models;

public sealed class ArchiveStatusDto
{
    public string State { get; set; } = "idle";
    public int PendingCount { get; set; }
    public int ProcessingCount { get; set; }
    public int FailedCount { get; set; }
    public int SucceededCount { get; set; }
    public int SkippedCount { get; set; }
    public string? LastSuccessAt { get; set; }
    public string? LastSuccessKind { get; set; }
    public string? LastSuccessPeriodEnd { get; set; }
    public string? LastSuccessFilePath { get; set; }
    public string? LastError { get; set; }
    public string? LastErrorAt { get; set; }
    public List<ArchiveRunDto> RecentRuns { get; set; } = [];
}
