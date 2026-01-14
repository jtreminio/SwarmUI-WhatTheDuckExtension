using FreneticUtilities.FreneticExtensions;
using SwarmUI.Core;
using SwarmUI.Text2Image;
using SwarmUI.Utils;

namespace WhatTheDuck;

public static class WildcardHandler
{
    private static Func<string, T2IPromptHandling.PromptTagContext, string> OriginalWildcardProcessor;

    private static Func<string, T2IPromptHandling.PromptTagContext, string> OriginalLengthEstimator;

    public static void Initialize()
    {
        if (T2IPromptHandling.PromptTagProcessors.TryGetValue("wildcard", out var origProcessor))
        {
            OriginalWildcardProcessor = origProcessor;
        }
        if (T2IPromptHandling.PromptTagLengthEstimators.TryGetValue("wildcard", out var origEstimator))
        {
            OriginalLengthEstimator = origEstimator;
        }

        T2IPromptHandling.PromptTagProcessors["wildcard"] = WildcardProcessor;
        T2IPromptHandling.PromptTagProcessors["wc"] = WildcardProcessor;
        T2IPromptHandling.PromptTagLengthEstimators["wildcard"] = WildcardLengthEstimator;
        T2IPromptHandling.PromptTagLengthEstimators["wc"] = WildcardLengthEstimator;
    }

    public static void Shutdown()
    {
    }

    public static void OnSettingsChanged()
    {
    }

    public static bool IsDatadumpWildcard(string card)
    {
        return DatadumpManager.GetDatadumpPath(card) is not null;
    }

    private static string WildcardProcessor(string data, T2IPromptHandling.PromptTagContext context)
    {
        data = context.Parse(data);
        string[] dataParts = data.SplitFast(',', 1);
        string wildcardName = dataParts[0];

        string card = T2IParamTypes.GetBestInList(wildcardName, WildcardsHelper.ListFiles);
        if (card is null)
        {
            context.TrackWarning($"Wildcard input '{wildcardName}' does not match any wildcard file and will be ignored.");
            return null;
        }

        if (DatadumpManager.GetDatadumpPath(card) is not null)
        {
            return ProcessDatadumpWildcard(data, dataParts, card, context);
        }

        return OriginalWildcardProcessor(data, context);
    }

    private static string ProcessDatadumpWildcard(
        string data,
        string[] dataParts,
        string card,
        T2IPromptHandling.PromptTagContext context)
    {
        HashSet<string> exclude = [];
        if (dataParts.Length > 1 && dataParts[1].StartsWithFast("not="))
        {
            exclude.UnionWith(T2IPromptHandling.SplitSmart(dataParts[1].After('=')));
        }

        (int count, string partSeparator) = T2IPromptHandling.InterpretPredataForRandom("random", context.PreData, data, context);
        if (partSeparator is null)
        {
            return null;
        }

        if (data.Length < card.Length)
        {
            Logs.Warning($"Wildcard input '{data}' is not a valid wildcard name, but appears to match '{card}', will use that instead.");
        }

        List<string> usedWildcards = context.Input.ExtraMeta.GetOrCreate("used_wildcards", () => new List<string>()) as List<string>;
        usedWildcards.Add(card);

        DatadumpCard datadumpCard = DatadumpManager.GetOrCreateIndex(card);

        if (datadumpCard is null || datadumpCard.LineCount == 0)
        {
            return "";
        }

        string result = "";
        HashSet<int> usedIndices = [];

        for (int i = 0; i < count; i++)
        {
            int index;
            string choice;
            int attempts = 0;
            const int maxAttempts = 1000;

            do
            {
                if (context.Input.Get(T2IParamTypes.WildcardSeedBehavior, "Random") == "Index")
                {
                    index = context.Input.GetWildcardSeed() % datadumpCard.LineCount;
                }
                else
                {
                    index = context.Input.GetWildcardRandom().Next(datadumpCard.LineCount);
                }

                choice = datadumpCard.GetLine(index);
                attempts++;

                if (attempts >= maxAttempts)
                {
                    break;
                }
            }
            while ((exclude.Contains(choice) || usedIndices.Contains(index)) && attempts < maxAttempts);

            usedIndices.Add(index);
            result += context.Parse(choice).Trim() + partSeparator;
        }

        return result.Trim();
    }

    private static string WildcardLengthEstimator(string data, T2IPromptHandling.PromptTagContext context)
    {
        string card = T2IParamTypes.GetBestInList(data.Before(','), WildcardsHelper.ListFiles);
        if (card is null)
        {
            return "";
        }

        if (IsDatadumpWildcard(card))
        {
            // For datadump files, we can't efficiently compute max length
            // Return a reasonable placeholder
            return "[datadump]";
        }

        return OriginalLengthEstimator(data, context);
    }
}
