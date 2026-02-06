using FreneticUtilities.FreneticExtensions;
using SwarmUI.Core;
using SwarmUI.Utils;
using System.IO;

namespace WhatTheDuck;

public static class DatadumpManager
{
    private const string PlaceholderContent = "# WhatTheDuck datadump placeholder - do not edit\n";
    private const string CacheDirectoryName = ".cache";

    public static bool Enabled { get; set; } = false;

    public static string DatadumpFolder { get; set; } = "";

    public static bool IsActive => Enabled && !string.IsNullOrWhiteSpace(DatadumpFolder);

    private static string CacheDirectory => Path.Combine(DatadumpFolder, CacheDirectoryName);

    private record DatadumpEntry(string WildcardName, string DatadumpPath, string FileHash);

    private static readonly ConcurrentDictionary<string, DatadumpEntry> DatadumpFiles = new();

    private static readonly ConcurrentDictionary<string, DatadumpCard> IndexCache = new();

    private static readonly ConcurrentDictionary<string, object> BuildLocks = new();

    private static string GetCacheFilePath(string key)
    {
        string safeFileName = key.Replace("/", "_").Replace("\\", "_") + ".bin";
        return Path.Combine(CacheDirectory, safeFileName);
    }

    private static void DeleteCacheFile(string key)
    {
        try
        {
            string cachePath = GetCacheFilePath(key);
            if (File.Exists(cachePath))
            {
                File.Delete(cachePath);
            }
        }
        catch
        {
            // Non-fatal
        }
    }

    public static void Initialize()
    {
        if (IsActive)
        {
            SyncPlaceholders();
        }
        Program.ModelRefreshEvent += OnModelRefresh;
    }

    public static void Shutdown()
    {
        Program.ModelRefreshEvent -= OnModelRefresh;
    }

    private static void OnModelRefresh()
    {
        if (IsActive)
        {
            SyncPlaceholders();
        }
    }

    /// <summary>
    /// Scans the datadump directory and creates placeholder files in the Wildcards directory.
    /// Never overwrites existing files in the Wildcards directory.
    /// </summary>
    public static void SyncPlaceholders()
    {
        SyncPlaceholdersInternal(invalidateChangedIndexes: false, out _, out _, out _);
    }

    private static void SyncPlaceholdersInternal(bool invalidateChangedIndexes, out int invalidatedCount, out int addedCount, out int removedCount)
    {
        invalidatedCount = 0;
        addedCount = 0;
        removedCount = 0;

        if (!IsActive)
        {
            DatadumpFiles.Clear();
            IndexCache.Clear();
            BuildLocks.Clear();
            return;
        }

        try
        {
            string datadumpDir = DatadumpFolder;
            string wildcardDir = WildcardsHelper.Folder;

            if (!Directory.Exists(datadumpDir))
            {
                Logs.Warning($"WhatTheDuck: Datadump directory does not exist: '{datadumpDir}'");
                return;
            }

            Directory.CreateDirectory(wildcardDir);

            HashSet<string> seenKeys = new();
            int created = 0;
            int skipped = 0;

            foreach (string datadumpFile in Directory.EnumerateFiles(datadumpDir, "*.txt", SearchOption.AllDirectories))
            {
                string relativePath = Path.GetRelativePath(datadumpDir, datadumpFile)
                    .Replace("\\", "/")
                    .TrimStart('/');

                string wildcardName = relativePath.BeforeLast('.');
                string key = wildcardName.ToLowerFast();
                string currentHash = DatadumpCard.ComputeFileHash(datadumpFile);

                seenKeys.Add(key);

                bool isNew = !DatadumpFiles.TryGetValue(key, out var existingEntry);
                bool hashChanged = !isNew && existingEntry.FileHash != currentHash;

                if (invalidateChangedIndexes)
                {
                    if (hashChanged)
                    {
                        IndexCache.TryRemove(key, out _);
                        BuildLocks.TryRemove(key, out _);
                        DeleteCacheFile(key);
                        invalidatedCount++;
                        Logs.Debug($"WhatTheDuck: Datadump file changed, invalidating cache: '{wildcardName}'");
                    }
                    else if (isNew)
                    {
                        addedCount++;
                        Logs.Debug($"WhatTheDuck: New datadump file detected: '{wildcardName}'");
                    }
                }

                DatadumpFiles[key] = new DatadumpEntry(wildcardName, datadumpFile, currentHash);

                string placeholderPath = Path.Combine(wildcardDir, relativePath);
                string placeholderDir = Path.GetDirectoryName(placeholderPath);
                if (!string.IsNullOrEmpty(placeholderDir) && !Directory.Exists(placeholderDir))
                {
                    Directory.CreateDirectory(placeholderDir);
                }

                if (!File.Exists(placeholderPath))
                {
                    File.WriteAllText(placeholderPath, PlaceholderContent);
                    created++;
                    Logs.Debug($"WhatTheDuck: Created placeholder for datadump '{wildcardName}'");
                }
                else
                {
                    skipped++;
                }
            }

            if (invalidateChangedIndexes)
            {
                var keysToRemove = DatadumpFiles.Keys.Where(k => !seenKeys.Contains(k)).ToList();
                foreach (string key in keysToRemove)
                {
                    if (DatadumpFiles.TryRemove(key, out var removed))
                    {
                        IndexCache.TryRemove(key, out _);
                        BuildLocks.TryRemove(key, out _);
                        DeleteCacheFile(key);
                        removedCount++;
                        Logs.Debug($"WhatTheDuck: Datadump file removed: '{removed.WildcardName}'");
                    }
                }
            }

            if (created > 0 || DatadumpFiles.Count > 0)
            {
                Logs.Info($"WhatTheDuck: Synced {DatadumpFiles.Count} datadump files ({created} placeholders created, {skipped} already existed)");
            }
        }
        catch (Exception ex)
        {
            Logs.Error($"WhatTheDuck: Error syncing datadump placeholders: {ex.Message}");
        }
    }

    public static string GetDatadumpPath(string wildcardName)
    {
        if (!IsActive)
        {
            return null;
        }
        return DatadumpFiles.TryGetValue(wildcardName.ToLowerFast(), out var entry) ? entry.DatadumpPath : null;
    }

    public static bool IsPlaceholder(string wildcardPath)
    {
        try
        {
            if (!File.Exists(wildcardPath))
            {
                return false;
            }

            FileInfo fi = new(wildcardPath);
            if (fi.Length > 200)
            {
                return false;
            }

            string content = File.ReadAllText(wildcardPath).Trim();

            // Must be exactly the placeholder comment (no additional content)
            return content == PlaceholderContent.Trim() ||
                   content == "# WhatTheDuck datadump placeholder - do not edit";
        }
        catch
        {
            return false;
        }
    }

    public static int Count => DatadumpFiles.Count;

    public static List<string> GetModifiedPlaceholders()
    {
        List<string> modified = new();

        if (!IsActive)
        {
            return modified;
        }

        try
        {
            string wildcardDir = WildcardsHelper.Folder;

            foreach (var kvp in DatadumpFiles)
            {
                DatadumpEntry entry = kvp.Value;
                string relativePath = entry.WildcardName + ".txt";
                string placeholderPath = Path.Combine(wildcardDir, relativePath.Replace("/", Path.DirectorySeparatorChar.ToString()));

                if (File.Exists(placeholderPath) && !IsPlaceholder(placeholderPath))
                {
                    // File exists but is no longer a placeholder - user modified it
                    modified.Add(entry.WildcardName);
                }
            }
        }
        catch (Exception ex)
        {
            Logs.Warning($"WhatTheDuck: Error checking for modified placeholders: {ex.Message}");
        }

        return modified;
    }

    public static DatadumpCard GetOrCreateIndex(string wildcardName)
    {
        string filePath = GetDatadumpPath(wildcardName);
        if (filePath is null)
        {
            return null;
        }

        string key = wildcardName.ToLowerFast();

        if (IndexCache.TryGetValue(key, out DatadumpCard existing))
        {
            return existing;
        }

        object lockObj = BuildLocks.GetOrAdd(key, _ => new object());
        lock (lockObj)
        {
            if (IndexCache.TryGetValue(key, out existing))
            {
                return existing;
            }

            var stopwatch = System.Diagnostics.Stopwatch.StartNew();
            DatadumpCard card = new(key, filePath);

            string cachePath = GetCacheFilePath(key);
            string currentHash = DatadumpCard.ComputeFileHash(filePath);

            if (card.TryLoadFromCache(cachePath, currentHash))
            {
                stopwatch.Stop();
                Logs.Info($"WhatTheDuck: Loaded '{wildcardName}' from cache ({card.LineCount:N0} lines, {stopwatch.ElapsedMilliseconds}ms)");
            }
            else
            {
                Logs.Info($"WhatTheDuck: Building line index for datadump '{wildcardName}'...");
                card.BuildIndex();
                card.SaveToCache(cachePath);
                stopwatch.Stop();
                Logs.Info($"WhatTheDuck: Indexed '{wildcardName}' with {card.LineCount:N0} lines in {stopwatch.ElapsedMilliseconds}ms (cached)");
            }

            IndexCache[key] = card;
            return card;
        }
    }

    public static void ClearCache()
    {
        IndexCache.Clear();
        BuildLocks.Clear();
    }

    public static (bool Success, int FileCount, string Message, string Error) Refresh()
    {
        if (!IsActive)
        {
            return (false, 0, null, "Datadump feature is not active. Enable it and set the path first.");
        }

        try
        {
            Logs.Info("WhatTheDuck: Manual refresh triggered - scanning for changes...");
            var stopwatch = System.Diagnostics.Stopwatch.StartNew();

            SyncPlaceholdersInternal(invalidateChangedIndexes: true, out int invalidated, out int added, out int removed);

            stopwatch.Stop();

            int totalChanges = invalidated + added + removed;
            string message;

            if (totalChanges == 0)
            {
                message = $"No changes detected. {Count} datadump file(s) indexed.";
                Logs.Info($"WhatTheDuck: Refresh complete - no changes detected ({stopwatch.ElapsedMilliseconds}ms)");
            }
            else
            {
                var parts = new List<string>();
                if (added > 0) parts.Add($"{added} added");
                if (invalidated > 0) parts.Add($"{invalidated} changed");
                if (removed > 0) parts.Add($"{removed} removed");

                message = $"Refresh complete: {string.Join(", ", parts)}. {Count} datadump file(s) total.";
                Logs.Info($"WhatTheDuck: Refresh complete - {string.Join(", ", parts)} ({stopwatch.ElapsedMilliseconds}ms)");
            }

            return (true, Count, message, null);
        }
        catch (Exception ex)
        {
            Logs.Error($"WhatTheDuck: Error during refresh: {ex.Message}");
            return (false, 0, null, ex.Message);
        }
    }
}
