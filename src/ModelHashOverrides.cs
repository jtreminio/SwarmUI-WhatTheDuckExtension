using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using SwarmUI.Accounts;
using SwarmUI.Core;
using SwarmUI.Text2Image;
using SwarmUI.Utils;
using SwarmUI.WebAPI;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;

namespace WhatTheDuck;

/// <summary>Extension-owned overrides, keyed by model subtype and relative model name.</summary>
public sealed class ModelHashOverrideStore(string path)
{
    private readonly object gate = new();
    private JObject values;

    private JObject Read()
    {
        if (values is not null)
        {
            return values;
        }
        JObject loaded = File.Exists(path) ? JObject.Parse(File.ReadAllText(path)) : new();
        foreach (JProperty type in loaded.Properties())
        {
            if (type.Value is not JObject models || models.Properties().Any(p => p.Value.Type != JTokenType.String || !IsValidHash(p.Value.Value<string>())))
            {
                throw new InvalidDataException("Invalid model hash override file. Repair the file before saving overrides.");
            }
        }
        return values = loaded;
    }

    private static string Name(string name) => name.Replace('\\', '/');

    public static bool IsValidHash(string hash) => hash is not null && Regex.IsMatch(hash, @"\A(?:0[xX])?[0-9a-fA-F]{1,64}\z");

    public string Get(string subtype, string model)
    {
        lock (gate)
        {
            return (Read()[subtype] as JObject)?.Value<string>(Name(model)) ?? "";
        }
    }

    public void Save(string subtype, string model, string hash)
    {
        hash = hash?.Trim() ?? "";
        if (hash.Length > 0 && !IsValidHash(hash))
        {
            throw new ArgumentException("Override hash must contain 1–64 hexadecimal characters, optionally prefixed with 0x.");
        }
        lock (gate)
        {
            JObject next = (JObject)Read().DeepClone();
            JObject models = next[subtype] as JObject ?? new();
            if (hash.Length == 0)
            {
                models.Remove(Name(model));
            }
            else
            {
                models[Name(model)] = hash;
            }
            if (models.Count == 0)
            {
                next.Remove(subtype);
            }
            else
            {
                next[subtype] = models;
            }
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
            string temp = $"{path}.{Guid.NewGuid():N}.tmp";
            try
            {
                File.WriteAllText(temp, next.ToString(Formatting.Indented));
                File.Move(temp, path, true);
                values = next;
            }
            finally
            {
                if (File.Exists(temp))
                {
                    File.Delete(temp);
                }
            }
        }
    }
}

public static class ModelHashOverrides
{
    public static string FilePath => Path.Combine(Program.DataDir, "WhatTheDuck", "ModelHashOverrides.json");
    private static readonly Lazy<ModelHashOverrideStore> Store = new(() => new(FilePath));
    private static bool registered;
    private static readonly MethodInfo CloneMethod = typeof(object).GetMethod("MemberwiseClone", BindingFlags.Instance | BindingFlags.NonPublic)!;

    public static void Register()
    {
        if (registered)
        {
            return;
        }
        registered = true;
        T2IEngine.PostGenerateEvent += data => Apply(data.UserInput, Store.Value);
    }

    /// <summary>Runs on the per-output input clone, after generation and before image/video metadata serialization.
    /// Copies models and their metadata so neither the shared cache nor model sidecars receive overrides.</summary>
    public static void Apply(T2IParamInput input, ModelHashOverrideStore store)
    {
        if (!Program.ServerSettings.Metadata.ImageMetadataIncludeModelHash)
        {
            return;
        }
        T2IModel Copy(T2IModel model)
        {
            if (model?.Handler?.ModelType is not string subtype)
            {
                return model;
            }
            string hash = store.Get(subtype, model.Name);
            if (hash.Length == 0)
            {
                return model;
            }
            // Memberwise copies retain all current and future Swarm model fields.
            T2IModel copy = (T2IModel)CloneMethod.Invoke(model, null)!;
            copy.Metadata = model.Metadata is null ? new() : (T2IModelHandler.ModelMetadataStore)CloneMethod.Invoke(model.Metadata, null)!;
            copy.Metadata.Hash = hash;
            return copy;
        }
        void ReplaceModels(Dictionary<string, object> values)
        {
            foreach ((string key, object value) in values.ToArray())
            {
                if (value is T2IModel model)
                {
                    values[key] = Copy(model);
                }
                else if (value is List<T2IModel> models)
                {
                    values[key] = models is MetadataModelList metadataModels
                        ? new MetadataModelList(models.Select(Copy), metadataModels.Names)
                        : models.Select(Copy).ToList();
                }
            }
        }
        ReplaceModels(input.InternalSet.ValuesInput);
        ReplaceModels(input.ExtraMeta);
        foreach ((string key, string subtype) in T2IParamInput.ModelListExtraKeys)
        {
            Dictionary<string, object> source = input.ExtraMeta.ContainsKey(key) ? input.ExtraMeta : input.InternalSet.ValuesInput;
            if (!source.TryGetValue(key, out object raw) || raw is not List<string> names
                || !Program.T2IModelSets.TryGetValue(subtype, out T2IModelHandler handler))
            {
                continue;
            }
            List<T2IModel> originals = names.Select(name => handler.GetModel(name)).ToList();
            List<T2IModel> copies = originals.Select(Copy).ToList();
            if (originals.Where((model, i) => !ReferenceEquals(model, copies[i])).Any())
            {
                source[key] = new MetadataModelList(copies, names);
            }
        }
    }

    // Core resolves List<string> entries through its shared model registry. Supply private
    // model copies while preserving the original list's JSON and textual representation.
    [JsonConverter(typeof(MetadataModelListConverter))]
    private sealed class MetadataModelList(IEnumerable<T2IModel> models, List<string> names) : List<T2IModel>(models)
    {
        public readonly List<string> Names = names;
        public override string ToString() => Names.ToString();
    }

    private sealed class MetadataModelListConverter : JsonConverter
    {
        public override bool CanConvert(Type type) => type == typeof(MetadataModelList);
        public override void WriteJson(JsonWriter writer, object value, JsonSerializer serializer) => serializer.Serialize(writer, ((MetadataModelList)value).Names);
        public override object ReadJson(JsonReader reader, Type type, object existing, JsonSerializer serializer) => throw new NotSupportedException();
        public override bool CanRead => false;
    }

    private static JObject Access(Session session, string model, string subtype, Func<JObject> action)
    {
        using var claim = Program.RefreshLock.LockRead();
        if (ModelsAPI.TryGetRefusalForModel(session, model, out JObject refusal))
        {
            return refusal;
        }
        if (!Program.T2IModelSets.TryGetValue(subtype, out T2IModelHandler handler) || !handler.Models.ContainsKey(model))
        {
            return new JObject { ["error"] = "Model not found." };
        }
        try
        {
            return action();
        }
        catch (Exception ex)
        {
            Logs.Warning($"WhatTheDuck: Model hash override failed: {ex.Message}");
            return new JObject { ["error"] = "Could not access model hash overrides. " + ex.Message };
        }
    }

    public static Task<JObject> WhatTheDuckGetModelHashOverride(Session session, string model, string subtype = "Stable-Diffusion") =>
        Task.FromResult(Access(session, model, subtype, () => new JObject { ["hash"] = Store.Value.Get(subtype, model), ["success"] = true }));

    public static Task<JObject> WhatTheDuckSaveModelHashOverride(Session session, string model, string hash, string subtype = "Stable-Diffusion") =>
        Task.FromResult(Access(session, model, subtype, () =>
        {
            Store.Value.Save(subtype, model, hash);
            return new JObject { ["success"] = true };
        }));
}
