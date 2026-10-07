using System.Reflection;
using HarmonyLib;
using ICU4N.Text;
using SwarmUI.Accounts;
using SwarmUI.Text2Image;

namespace WhatTheDuck;

/// <summary>Normalizes generated output paths before SwarmUI allocates a filename or writes any files.</summary>
public static class OutputFilenameNormalization
{
    private static readonly object RegistrationLock = new();
    private static bool registered;
    private static volatile bool enabled;

    public static bool Enabled => enabled;

    /// <summary>Installs the path-builder postfix once, then changes its behavior without restarting SwarmUI.</summary>
    public static void Configure(bool value)
    {
        lock (RegistrationLock)
        {
            if (value && !registered)
            {
                // SwarmUI runs with invariant globalization, where string.Normalize is a no-op.
                // Initialize the managed Unicode data before enabling the feature.
                if (NormalizePath("i\u0308", false) != "\u00ef" || NormalizePath("\u00ef", true) != "i\u0308")
                {
                    throw new InvalidOperationException("Unicode filename normalization is unavailable.");
                }
                MethodInfo original = typeof(User).GetMethod(nameof(User.BuildImageOutputPath), [typeof(T2IParamInput), typeof(int)])
                    ?? throw new MissingMethodException("SwarmUI's output path builder could not be found.");
                MethodInfo postfix = typeof(OutputFilenameNormalization).GetMethod(nameof(NormalizeOutputPath), BindingFlags.NonPublic | BindingFlags.Static);
                new Harmony("WhatTheDuck.OutputFilenameNormalization").Patch(original, postfix: new HarmonyMethod(postfix));
                registered = true;
            }
            enabled = value;
        }
    }

    /// <summary>Uses Syncthing's server-platform convention: NFD on macOS, NFC elsewhere.
    /// Canonical normalization preserves accents, case, path separators, and numbering placeholders.</summary>
    public static string NormalizePath(string path, bool macOS)
    {
        if (string.IsNullOrEmpty(path))
        {
            return path;
        }
        return (macOS ? Normalizer2.NFDInstance : Normalizer2.NFCInstance).Normalize(path);
    }

    /// <summary>Changes only the finished output path, leaving prompts and metadata untouched.
    /// Session.SaveImage subsequently uses this same path for collision checks, files, caches, and URLs.</summary>
    private static void NormalizeOutputPath(ref string __result)
    {
        if (enabled)
        {
            __result = NormalizePath(__result, OperatingSystem.IsMacOS());
        }
    }
}
