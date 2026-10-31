namespace WhatTheDuck;

/// <summary>Coalesces model refresh notifications and retains failed work until reconciliation succeeds.</summary>
public sealed class CivitaiRefreshSignal
{
    /// <summary>Starts pending because startup must reconcile the persisted inventory once.</summary>
    private int pending = 1;
    /// <summary>Wakes an idle resolver without periodic inventory polling.</summary>
    private readonly SemaphoreSlim wake = new(0, 1);

    public void Request()
    {
        Interlocked.Exchange(ref pending, 1);
        try
        {
            wake.Release();
        }
        catch (SemaphoreFullException) { } // Multiple notifications share one pending wake-up.
    }

    public async Task ReconcileAsync(Func<Task> reconcile)
    {
        if (Interlocked.Exchange(ref pending, 0) == 0)
        {
            return;
        }
        try
        {
            await reconcile();
        }
        catch
        {
            Request();
            throw;
        }
    }

    public Task WaitAsync(long delayMilliseconds, CancellationToken cancellation)
        => wake.WaitAsync(delayMilliseconds == long.MaxValue ? Timeout.Infinite : (int)Math.Clamp(delayMilliseconds, 0, int.MaxValue), cancellation);
}
