namespace AugmentScale.Data.Services;

public interface IScaleHealthService
{
    void RecordScaleHealth(string eventType, string details, DateTimeOffset? at = null);
}
