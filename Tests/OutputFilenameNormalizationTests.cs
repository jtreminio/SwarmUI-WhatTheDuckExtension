using System.Runtime.CompilerServices;
using System.Reflection;
using Newtonsoft.Json.Linq;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SwarmUI.Accounts;
using SwarmUI.Core;
using SwarmUI.Media;
using SwarmUI.Text2Image;
using SwarmUI.Utils;
using WhatTheDuck;
using Xunit;

[CollectionDefinition("Output filenames", DisableParallelization = true)]
public class OutputFilenameCollection { }

[Collection("Output filenames")]
public class OutputFilenameNormalizationTests : IDisposable
{
    private readonly bool originalEnabled = OutputFilenameNormalization.Enabled;

    [Theory]
    [InlineData("Alai\u0308a", "Ala\u00efa")]
    [InlineData("Cafe\u0301/Angstro\u0308m-[number]", "Caf\u00e9/Angstr\u00f6m-[number]")]
    [InlineData("\u1100\u1161\u11a8", "\uac01")]
    [InlineData("\u03b1\u0301", "\u03ac")]
    [InlineData("ASCII/[number]/東京-🦆-\ufb01", "ASCII/[number]/東京-🦆-\ufb01")]
    [InlineData("", "")]
    public void NormalizesCanonicalUnicodeEvenWithInvariantGlobalization(string decomposed, string composed)
    {
        Assert.True(AppContext.TryGetSwitch("System.Globalization.Invariant", out bool invariant) && invariant);
        Assert.Equal(composed, OutputFilenameNormalization.NormalizePath(decomposed, false));
        Assert.Equal(decomposed, OutputFilenameNormalization.NormalizePath(composed, true));
        Assert.Equal(composed, OutputFilenameNormalization.NormalizePath(composed, false));
        Assert.Equal(decomposed, OutputFilenameNormalization.NormalizePath(decomposed, true));
    }

    private static Session CreateSession()
    {
        if (T2IParamTypes.Prompt is null)
        {
            T2IParamTypes.RegisterDefaults();
        }
        User user = (User)RuntimeHelpers.GetUninitializedObject(typeof(User));
        user.Settings = new Settings.User();
        user.UserLock = new();
        user.Data = new User.DatabaseEntry { ID = "normalization-test" };
        user.CalculatedRole = new Role("normalization-test");
        user.Settings.OutPathBuilder.Format = "raw/[prompt]-[batch_id]-[number]";
        return new Session { User = user };
    }

    [Fact]
    public async Task SettingPersistsAndReloadsThroughExtensionSettings()
    {
        string root = Path.Combine(Path.GetTempPath(), $"wtd-settings-{Guid.NewGuid():N}");
        string originalDataDir = Program.DataDir;
        try
        {
            Directory.CreateDirectory(root);
            Program.DataDir = root;
            WhatTheDuckExtension extension = new();
            async Task Save(bool value)
            {
                JObject result = await extension.WhatTheDuckSaveSettings(null, WhatTheDuckExtension.KeyboardNavigationEnabled,
                    WhatTheDuckExtension.TrimPromptVariables, clipboardPathFrom: WhatTheDuckExtension.ClipboardPathFrom,
                    clipboardPathTo: WhatTheDuckExtension.ClipboardPathTo, normalizeOutputFilenames: value);
                Assert.True(result.Value<bool>("success"), result.ToString());
                JObject saved = JObject.Parse(await File.ReadAllTextAsync(Path.Combine(root, "WhatTheDuckSettings.json")));
                Assert.Equal(value, saved.Value<bool>("normalizeOutputFilenames"));
            }
            await Save(true);
            OutputFilenameNormalization.Configure(false);
            typeof(WhatTheDuckExtension).GetMethod("LoadSettings", BindingFlags.NonPublic | BindingFlags.Instance)!.Invoke(extension, null);
            Assert.True(OutputFilenameNormalization.Enabled);
            Assert.True((await extension.WhatTheDuckGetSettings(null)).Value<bool>("normalizeOutputFilenames"));
            await Save(false);
            Assert.False(OutputFilenameNormalization.Enabled);
        }
        finally
        {
            Program.DataDir = originalDataDir;
            if (Directory.Exists(root))
            {
                Directory.Delete(root, true);
            }
        }
    }

    [Fact]
    public void ToggleChangesActualPathBuilderWithoutChangingPromptOrTemplate()
    {
        Session session = CreateSession();
        T2IParamInput input = new(session);
        input.Set(T2IParamTypes.Prompt, "Alai\u0308a");
        input.ExtraMeta["original_prompt"] = "original Alai\u0308a";
        string expectedRaw = "raw/Alai\u0308a-7-[number]";
        string expectedNormalized = OutputFilenameNormalization.NormalizePath(expectedRaw, OperatingSystem.IsMacOS());

        OutputFilenameNormalization.Configure(false);
        Assert.Equal(expectedRaw, session.User.BuildImageOutputPath(input, 7));
        OutputFilenameNormalization.Configure(true);
        OutputFilenameNormalization.Configure(true); // Registration must be safe to repeat.
        Assert.Equal(expectedNormalized, session.User.BuildImageOutputPath(input, 7));
        Assert.Equal("Alai\u0308a", input.Get(T2IParamTypes.Prompt));
        Assert.Equal("original Alai\u0308a", input.ExtraMeta["original_prompt"]);
        Assert.Equal("raw/[prompt]-[batch_id]-[number]", session.User.Settings.OutPathBuilder.Format);
        Assert.False(input.TryGet(T2IParamTypes.OverrideOutpathFormat, out string _));

        input.Set(T2IParamTypes.OverrideOutpathFormat, "Cafe\u0301/[prompt]-[number]");
        Assert.Equal(OutputFilenameNormalization.NormalizePath("Cafe\u0301/Alai\u0308a-[number]", OperatingSystem.IsMacOS()),
            session.User.BuildImageOutputPath(input, 7));
        OutputFilenameNormalization.Configure(false);
        Assert.Equal("Cafe\u0301/Alai\u0308a-[number]", session.User.BuildImageOutputPath(input, 7));
    }

    [Fact]
    public async Task SavesMatchingFileSidecarAndUrlWithoutOverwritingNormalizedName()
    {
        string root = Path.Combine(Path.GetTempPath(), $"wtd-output-{Guid.NewGuid():N}");
        string originalOutput = Program.ServerSettings.Paths.OutputPath;
        bool originalAppendUser = Program.ServerSettings.Paths.AppendUserNameToOutputPath;
        bool originalPerFolder = Program.ServerSettings.Metadata.ImageMetadataPerFolder;
        List<string> savedPaths = [];
        try
        {
            Program.ServerSettings.Paths.OutputPath = root;
            Program.ServerSettings.Paths.AppendUserNameToOutputPath = false;
            Program.ServerSettings.Metadata.ImageMetadataPerFolder = true;
            Session session = CreateSession();
            session.User.Settings.FileFormat.SaveTextFileMetadata = true;
            T2IParamInput input = new(session);
            input.Set(T2IParamTypes.Prompt, "Alai\u0308a");
            input.Set(T2IParamTypes.ImageFormat, "PNG");
            OutputFilenameNormalization.Configure(true);
            string stem = OutputFilenameNormalization.NormalizePath("raw/Alai\u0308a-7-", OperatingSystem.IsMacOS());
            string existingPath = Path.Combine(root, stem + "1.png");
            Directory.CreateDirectory(Path.GetDirectoryName(existingPath)!);
            await File.WriteAllTextAsync(existingPath, "existing file");
            using Image<Rgba32> sample = new(1, 1);
            using MemoryStream pngStream = new();
            sample.SaveAsPng(pngStream);
            byte[] png = pngStream.ToArray();
            const string metadata = "{\"prompt\":\"Alai\\u0308a\"}";

            for (int number = 2; number <= 3; number++)
            {
                T2IEngine.ImageOutput output = new() { File = new MediaFile { RawData = png, Type = MediaType.ImagePng } };
                (string url, string path) = session.SaveImage(output, 7, input, metadata);
                savedPaths.Add(path);
                Assert.Equal($"Output/{stem}{number}.png", url);
                Assert.Equal(Path.Combine(root, $"{stem}{number}.png"), path);
            }
            // SaveImage completes its disk write asynchronously, then holds its byte cache for ten seconds.
            await WaitForSaves(savedPaths);
            foreach (string path in savedPaths)
            {
                Assert.Equal(png, await File.ReadAllBytesAsync(path));
                Assert.Equal(metadata, await File.ReadAllTextAsync(Path.ChangeExtension(path, ".swarm.json")));
            }
            Assert.Equal("existing file", await File.ReadAllTextAsync(existingPath));
        }
        finally
        {
            await WaitForSaves(savedPaths);
            Program.ServerSettings.Paths.OutputPath = originalOutput;
            Program.ServerSettings.Paths.AppendUserNameToOutputPath = originalAppendUser;
            Program.ServerSettings.Metadata.ImageMetadataPerFolder = originalPerFolder;
            foreach (string folder in OutputMetadataTracker.Databases.Keys.Where(p => p.StartsWith(root)).ToArray())
            {
                if (OutputMetadataTracker.Databases.TryRemove(folder, out OutputMetadataTracker.OutputDatabase database))
                {
                    database.Dispose();
                }
            }
            foreach (string path in savedPaths)
            {
                Session.RecentlyBlockedFilenames.TryRemove(path, out _);
            }
            if (Directory.Exists(root))
            {
                Directory.Delete(root, true);
            }
        }
    }

    private static async Task WaitForSaves(List<string> paths)
    {
        using CancellationTokenSource timeout = new(TimeSpan.FromSeconds(20));
        while (paths.Any(Session.StillSavingFiles.ContainsKey))
        {
            await Task.Delay(50, timeout.Token);
        }
    }

    public void Dispose() => OutputFilenameNormalization.Configure(originalEnabled);
}
