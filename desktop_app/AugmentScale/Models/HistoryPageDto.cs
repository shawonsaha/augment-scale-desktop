namespace AugmentScale.Models;

/// <summary>
/// One page of the History screen plus aggregate values for the active filters.
/// Only <see cref="Tickets"/> crosses the bridge for the visible page.
/// </summary>
public sealed class HistoryPageDto
{
    public List<TicketDto> Tickets { get; set; } = [];
    public int Total { get; set; }
    public int Page { get; set; }
    public int PageSize { get; set; }
    public double NetKg { get; set; }
    public HistoryFilterOptionsDto? Options { get; set; }
}

public sealed class HistoryFilterOptionsDto
{
    public List<string> Drivers { get; set; } = [];
    public List<string> Operators { get; set; } = [];
    public List<string> Materials { get; set; } = [];
    public List<string> Clients { get; set; } = [];
}
