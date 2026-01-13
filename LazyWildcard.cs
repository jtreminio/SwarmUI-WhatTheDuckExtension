using FreneticUtilities.FreneticExtensions;
using FreneticUtilities.FreneticToolkit;
using SwarmUI.Utils;
using System.IO;
using System.Text;

namespace WhatTheDuck;

/// <summary>
/// Manages lazy-loaded wildcards for large files (50MB+).
/// Only stores line byte offsets, not the actual content.
/// Files under the threshold use the standard WildcardsHelper from SwarmUI core.
/// </summary>
public static class LazyWildcardManager
{
    /// <summary>Cache of lazy wildcards by name.</summary>
    private static readonly ConcurrentDictionary<string, LazyWildcard> Cache = new();

    /// <summary>Lock objects for building indexes.</summary>
    private static readonly ConcurrentDictionary<string, object> BuildLocks = new();

    /// <summary>Gets or creates a lazy wildcard for the given file.</summary>
    public static LazyWildcard GetOrCreate(string name, string filePath)
    {
        string key = name.ToLowerFast();

        if (Cache.TryGetValue(key, out LazyWildcard existing))
        {
            return existing;
        }

        // Need to build the index - use a lock to prevent duplicate work
        object lockObj = BuildLocks.GetOrAdd(key, _ => new object());
        lock (lockObj)
        {
            if (Cache.TryGetValue(key, out existing))
            {
                return existing;
            }

            Logs.Info($"WhatTheDuck: Building line index for large wildcard '{name}'...");
            var stopwatch = System.Diagnostics.Stopwatch.StartNew();

            LazyWildcard lazy = new(name, filePath);
            lazy.BuildIndex();

            stopwatch.Stop();
            Logs.Info($"WhatTheDuck: Indexed '{name}' with {lazy.LineCount:N0} lines in {stopwatch.ElapsedMilliseconds}ms");

            Cache[key] = lazy;
            return lazy;
        }
    }

    /// <summary>Clears the cache (e.g., on refresh).</summary>
    public static void ClearCache()
    {
        Cache.Clear();
    }
}

/// <summary>
/// Represents a large wildcard file that is loaded lazily.
/// Only stores line byte offsets, reads lines on demand.
/// </summary>
public class LazyWildcard
{
    /// <summary>The wildcard name.</summary>
    public string Name { get; }

    /// <summary>Full path to the file.</summary>
    public string FilePath { get; }

    /// <summary>Byte offsets where each valid line starts in the file.</summary>
    private long[] _lineOffsets;

    /// <summary>Byte lengths of each line (excluding newline).</summary>
    private int[] _lineLengths;

    /// <summary>Number of valid (non-empty, non-comment) lines.</summary>
    public int LineCount => _lineOffsets?.Length ?? 0;

    /// <summary>File modification time when index was built.</summary>
    public long IndexedAtModTime { get; private set; }

    public LazyWildcard(string name, string filePath)
    {
        Name = name;
        FilePath = filePath;
    }

    /// <summary>
    /// Scans the file to build an index of valid line positions.
    /// A valid line is non-empty after trimming and removing comments.
    /// </summary>
    public void BuildIndex()
    {
        var offsets = new List<long>();
        var lengths = new List<int>();
        IndexedAtModTime = new DateTimeOffset(File.GetLastWriteTimeUtc(FilePath)).ToUnixTimeMilliseconds();
        byte[] fileBytes = File.ReadAllBytes(FilePath);
        long currentOffset = 0;

        // Skip BOM if present (UTF-8 BOM is EF BB BF)
        if (fileBytes.Length >= 3 && fileBytes[0] == 0xEF && fileBytes[1] == 0xBB && fileBytes[2] == 0xBF)
        {
            currentOffset = 3;
        }

        long lineStart = currentOffset;

        for (long i = currentOffset; i <= fileBytes.Length; i++)
        {
            bool isEndOfFile = i == fileBytes.Length;
            bool isNewline = !isEndOfFile && (fileBytes[i] == '\n' || fileBytes[i] == '\r');

            if (isNewline || isEndOfFile)
            {
                int lineLength = (int)(i - lineStart);

                if (lineLength > 0)
                {
                    string line = Encoding.UTF8.GetString(fileBytes, (int)lineStart, lineLength);
                    string processed = line.Before('#').Trim();

                    if (!string.IsNullOrWhiteSpace(processed))
                    {
                        offsets.Add(lineStart);
                        lengths.Add(lineLength);
                    }
                }

                if (!isEndOfFile)
                {
                    if (fileBytes[i] == '\r' && i + 1 < fileBytes.Length && fileBytes[i + 1] == '\n')
                    {
                        i++;
                    }
                    lineStart = i + 1;
                }
            }
        }

        _lineOffsets = [.. offsets];
        _lineLengths = [.. lengths];
    }

    /// <summary>
    /// Gets a specific line by index, reading it fresh from disk.
    /// Returns the processed line (comment stripped, trimmed).
    /// </summary>
    public string GetLine(int index)
    {
        if (_lineOffsets is null || (uint)index >= (uint)_lineOffsets.Length)
        {
            return string.Empty;
        }

        long offset = _lineOffsets[index];
        int maxLen = _lineLengths[index];

        using FileStream fs = new(FilePath, FileMode.Open, FileAccess.Read, FileShare.Read);
        fs.Seek(offset, SeekOrigin.Begin);
        byte[] buffer = new byte[maxLen];
        int bytesRead = fs.Read(buffer, 0, maxLen);

        if (bytesRead == 0)
        {
            return string.Empty;
        }

        return Encoding.UTF8.GetString(buffer, 0, bytesRead).TrimEnd('\r', '\n').Before('#').Trim();
    }

    /// <summary>
    /// Gets multiple random lines efficiently by batching disk reads.
    /// </summary>
    public string[] GetLines(int[] indices)
    {
        string[] results = new string[indices.Length];
        var sortedPairs = indices
            .Select((idx, i) => (OriginalPosition: i, LineIndex: idx))
            .OrderBy(p => _lineOffsets[p.LineIndex])
            .ToArray();

        using FileStream fs = new(FilePath, FileMode.Open, FileAccess.Read, FileShare.Read, bufferSize: 65536);

        foreach (var (originalPos, lineIndex) in sortedPairs)
        {
            if ((uint)lineIndex >= (uint)_lineOffsets.Length)
            {
                results[originalPos] = string.Empty;
                continue;
            }

            long offset = _lineOffsets[lineIndex];
            int maxLen = _lineLengths[lineIndex];

            fs.Seek(offset, SeekOrigin.Begin);

            byte[] buffer = new byte[maxLen];
            int bytesRead = fs.Read(buffer, 0, maxLen);

            if (bytesRead == 0)
            {
                results[originalPos] = string.Empty;
                continue;
            }

            string line = Encoding.UTF8.GetString(buffer, 0, bytesRead).TrimEnd('\r', '\n');
            results[originalPos] = line.Before('#').Trim();
        }

        return results;
    }
}
