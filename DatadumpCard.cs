using FreneticUtilities.FreneticExtensions;
using System.IO;
using System.Text;

namespace WhatTheDuck;

public class DatadumpCard
{
    public string Name { get; }

    public string FilePath { get; }

    private long[] _lineOffsets;

    private int[] _lineLengths;

    public int LineCount => _lineOffsets?.Length ?? 0;

    public DatadumpCard(string name, string filePath)
    {
        Name = name;
        FilePath = filePath;
    }

    public void BuildIndex()
    {
        var offsets = new List<long>();
        var lengths = new List<int>();

        const int BufferSize = 1024 * 1024;
        using FileStream fs = new(FilePath, FileMode.Open, FileAccess.Read, FileShare.Read, BufferSize);

        long fileLength = fs.Length;
        long currentOffset = 0;

        // Skip BOM if present (UTF-8 BOM is EF BB BF)
        if (fileLength >= 3)
        {
            byte[] bom = new byte[3];
            fs.Read(bom, 0, 3);
            if (bom[0] == 0xEF && bom[1] == 0xBB && bom[2] == 0xBF)
            {
                currentOffset = 3;
            }
            else
            {
                fs.Seek(0, SeekOrigin.Begin);
            }
        }

        using MemoryStream lineBuffer = new();
        byte[] readBuffer = new byte[BufferSize];
        long lineStart = currentOffset;
        int bytesRead;
        bool previousWasCR = false;

        while ((bytesRead = fs.Read(readBuffer, 0, BufferSize)) > 0)
        {
            for (int i = 0; i < bytesRead; i++)
            {
                byte b = readBuffer[i];

                // Handle LF that follows CR from previous buffer
                if (previousWasCR)
                {
                    previousWasCR = false;
                    if (b == '\n')
                    {
                        currentOffset++;
                        lineStart = currentOffset;
                        continue;
                    }
                }

                if (b == '\n' || b == '\r')
                {
                    TryAddLine(lineBuffer, lineStart, offsets, lengths);
                    lineBuffer.SetLength(0);

                    if (b == '\r')
                    {
                        if (i + 1 < bytesRead)
                        {
                            if (readBuffer[i + 1] == '\n')
                            {
                                i++;
                                currentOffset++;
                            }
                        }
                        else
                        {
                            // CR at end of buffer - mark for next iteration
                            previousWasCR = true;
                        }
                    }

                    currentOffset++;
                    lineStart = currentOffset;
                }
                else
                {
                    lineBuffer.WriteByte(b);
                    currentOffset++;
                }
            }
        }

        // Handle last line if file doesn't end with newline
        if (lineBuffer.Length > 0)
        {
            TryAddLine(lineBuffer, lineStart, offsets, lengths);
        }

        _lineOffsets = [.. offsets];
        _lineLengths = [.. lengths];
    }

    private static void TryAddLine(MemoryStream lineBuffer, long lineStart, List<long> offsets, List<int> lengths)
    {
        int lineLength = (int)lineBuffer.Length;
        if (lineLength == 0)
        {
            return;
        }

        byte[] lineBytes = lineBuffer.ToArray();
        string line = Encoding.UTF8.GetString(lineBytes, 0, lineLength);
        string processed = line.Before('#').Trim();

        if (!string.IsNullOrWhiteSpace(processed))
        {
            offsets.Add(lineStart);
            lengths.Add(lineLength);
        }
    }

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
}
