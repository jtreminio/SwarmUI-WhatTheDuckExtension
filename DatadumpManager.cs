using FreneticUtilities.FreneticExtensions;
using SwarmUI.Core;
using SwarmUI.Utils;
using System.IO;

namespace WhatTheDuck;

public static class DatadumpManager
{
    private const string PlaceholderContent = "# WhatTheDuck datadump placeholder - do not edit\n";

    public static bool Enabled { get; set; } = false;

    public static string DatadumpFolder { get; set; } = "";

    public static bool IsActive => Enabled && !string.IsNullOrWhiteSpace(DatadumpFolder);

    private record DatadumpEntry(string WildcardName, string DatadumpPath);

    private static readonly ConcurrentDictionary<string, DatadumpEntry> DatadumpFiles = new();

    private static readonly ConcurrentDictionary<string, DatadumpCard> IndexCache = new();

    private static readonly ConcurrentDictionary<string, object> BuildLocks = new();

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
        if (!IsActive)
        {
            DatadumpFiles.Clear();
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

            DatadumpFiles.Clear();
            int created = 0;
            int skipped = 0;

            foreach (string datadumpFile in Directory.EnumerateFiles(datadumpDir, "*.txt", SearchOption.AllDirectories))
            {
                string relativePath = Path.GetRelativePath(datadumpDir, datadumpFile)
                    .Replace("\\", "/")
                    .TrimStart('/');

                string wildcardName = relativePath.BeforeLast('.');
                string placeholderPath = Path.Combine(wildcardDir, relativePath);

                DatadumpFiles[wildcardName.ToLowerFast()] = new DatadumpEntry(wildcardName, datadumpFile);

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

            Logs.Info($"WhatTheDuck: Building line index for datadump '{wildcardName}'...");
            var stopwatch = System.Diagnostics.Stopwatch.StartNew();

            DatadumpCard card = new(key, filePath);
            card.BuildIndex();

            stopwatch.Stop();
            Logs.Info($"WhatTheDuck: Indexed '{wildcardName}' with {card.LineCount:N0} lines in {stopwatch.ElapsedMilliseconds}ms");

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
            Logs.Info("WhatTheDuck: Manual refresh triggered - rescanning datadump files...");
            var stopwatch = System.Diagnostics.Stopwatch.StartNew();
            ClearCache();
            SyncPlaceholders();
            stopwatch.Stop();
            Logs.Info($"WhatTheDuck: Refresh complete - {Count} datadump files found in {stopwatch.ElapsedMilliseconds}ms");

            return (true, Count, $"Refresh complete. Found {Count} datadump file(s). Indexes will be rebuilt on first use.", null);
        }
        catch (Exception ex)
        {
            Logs.Error($"WhatTheDuck: Error during refresh: {ex.Message}");
            return (false, 0, null, ex.Message);
        }
    }
}
