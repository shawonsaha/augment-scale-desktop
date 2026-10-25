using AugmentScale.Models;
using AugmentScale.Models.Commands;

namespace AugmentScale.Data.Services;

public interface IReportService
{
    HistoryReportDto GenerateHistoryReport(HistoryReportRequest req);
    HistoryReportVerificationDto VerifyHistoryReport(VerifyHistoryReportRequest req);
    HistoryReportDto? GenerateArchiveReport(DateOnly fromDate, DateOnly toDate);
    DateOnly? GetEarliestReportDate();
}
