namespace AugmentScale.Models;

public sealed class ArchiveRunDto
{
    public string Id { get; set; } = string.Empty;
    public string Kind { get; set; } = string.Empty;
    public string PeriodStart { get; set; } = string.Empty;
    public string PeriodEnd { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string? FilePath { get; set; }
    public string? ReportId { get; set; }
    public string? IntegrityHash { get; set; }
    public string? ErrorMessage { get; set; }
    public int AttemptCount { get; set; }
    public string? NextAttemptAt { get; set; }
    public string CreatedAt { get; set; } = string.Empty;
    public string? StartedAt { get; set; }
    public string? CompletedAt { get; set; }
    public string UpdatedAt { get; set; } = string.Empty;
}
