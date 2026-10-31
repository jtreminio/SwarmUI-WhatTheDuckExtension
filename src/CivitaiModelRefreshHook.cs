using HarmonyLib;
using SwarmUI.Text2Image;
using System.Reflection;
using System.IO;
using System.Runtime.CompilerServices;

namespace WhatTheDuck;

/// <summary>Observes completed local model-list refreshes, including direct downloader calls.</summary>
public static class CivitaiModelRefreshHook
{
    /// <summary>Protects installation and removal of this extension's hook.</summary>
    private static readonly object Gate = new();
    /// <summary>Dedicated patch owner; other extension patches are never removed.</summary>
    private static readonly Harmony Patcher = new("WhatTheDuck.CivitaiModelRefresh");
    /// <summary>Only queues work; never performs file IO or takes inventory locks.</summary>
    private static volatile Action refreshed;
    /// <summary>Whether the completion hook is currently installed.</summary>
    private static bool installed;
    /// <summary>Resave completion establishes which file version the existing Swarm hash describes, without changing its cache.</summary>
    private static readonly ConditionalWeakTable<T2IModel, ResaveStamp> Resaved = new();

    private sealed record ResaveStamp(string Hash, long FileVersion);

    public static long CachedFileVersion(T2IModel model)
    {
        lock (Gate)
        {
            return Resaved.TryGetValue(model, out ResaveStamp stamp) && stamp.Hash == model.Metadata?.Hash
                ? stamp.FileVersion : model.Metadata?.ModelFileVersion ?? 0;
        }
    }

    public static void Register(Action onRefresh)
    {
        lock (Gate)
        {
            if (!installed)
            {
                MethodInfo original = typeof(T2IModelHandler).GetMethod(nameof(T2IModelHandler.Refresh), Type.EmptyTypes)
                    ?? throw new MissingMethodException("SwarmUI's model refresh method could not be found.");
                MethodInfo postfix = typeof(CivitaiModelRefreshHook).GetMethod(nameof(AfterRefresh), BindingFlags.NonPublic | BindingFlags.Static);
                MethodInfo resave = typeof(T2IModel).GetMethod(nameof(T2IModel.ResaveModel), [typeof(FileStream)])
                    ?? throw new MissingMethodException("SwarmUI's model resave method could not be found.");
                MethodInfo afterResave = typeof(CivitaiModelRefreshHook).GetMethod(nameof(AfterResave), BindingFlags.NonPublic | BindingFlags.Static);
                try
                {
                    Patcher.Patch(original, postfix: new HarmonyMethod(postfix));
                    Patcher.Patch(resave, postfix: new HarmonyMethod(afterResave));
                }
                catch
                {
                    Patcher.UnpatchAll(Patcher.Id);
                    throw;
                }
                installed = true;
            }
            refreshed = onRefresh;
        }
    }

    public static void Unregister()
    {
        lock (Gate)
        {
            refreshed = null;
            Resaved.Clear();
            if (installed)
            {
                Patcher.UnpatchAll(Patcher.Id);
                installed = false;
            }
        }
    }

    private static void AfterRefresh(T2IModelHandler __instance)
    {
        if (!__instance.IsShutdown && __instance.ModelType is "Stable-Diffusion" or "LoRA")
        {
            refreshed?.Invoke();
        }
    }

    private static void AfterResave(T2IModel __instance)
    {
        if (__instance.Metadata is null || __instance.Handler?.ModelType is not ("Stable-Diffusion" or "LoRA"))
        {
            return;
        }
        try
        {
            long version = new DateTimeOffset(File.GetLastWriteTimeUtc(__instance.RawFilePath)).ToUnixTimeMilliseconds();
            lock (Gate)
            {
                Resaved.Remove(__instance);
                Resaved.Add(__instance, new(__instance.Metadata.Hash, version));
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        // Core downloader refreshes before resaving. Queue again only after the synchronous resave finishes.
        refreshed?.Invoke();
    }
}
