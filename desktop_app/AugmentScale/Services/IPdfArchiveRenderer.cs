using AugmentScale.Models;

namespace AugmentScale.Services;

public interface IPdfArchiveRenderer
{
    Task RenderAsync(HistoryReportDto report, string outputPath, CancellationToken cancellationToken);
}
