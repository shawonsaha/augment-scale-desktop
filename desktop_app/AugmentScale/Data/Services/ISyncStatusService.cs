using AugmentScale.Models;

namespace AugmentScale.Data.Services;

public interface ISyncStatusService
{
    SyncStatusDto GetSyncStatus();
}
