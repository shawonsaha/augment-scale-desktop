using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AugmentScale.Models;

namespace AugmentScale.Services;

/// <summary>
/// Owns setup.json and secrets.dat. Secrets are protected with Windows DPAPI
/// (current user) and PINs are never stored in plaintext after first run.
/// </summary>
public sealed class ConfigService
{
    private const int Iterations = 100_000;
    private const int HashLength = 32;
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("AugmentScale.Secrets.v1");

    private readonly string _dataDirectory;
    private readonly string _setupPath;
    private readonly string _secretsPath;
    private readonly object _gate = new();
    private readonly JsonSerializerOptions _json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
    };

    private SetupConfig? _setup;
    private AppSecrets? _secrets;

    public ConfigService(string? dataDirectory = null)
    {
        var overrideDirectory = Environment.GetEnvironmentVariable("AUGMENTSCALE_DATA_DIR");
        _dataDirectory = dataDirectory ?? (!string.IsNullOrWhiteSpace(overrideDirectory)
            ? Path.GetFullPath(overrideDirectory)
            : DefaultDataDirectory);
        Directory.CreateDirectory(_dataDirectory);
        _setupPath = Path.Combine(_dataDirectory, "setup.json");
        _secretsPath = Path.Combine(_dataDirectory, "secrets.dat");
    }

    public string DataDirectory => _dataDirectory;

    public bool IsDefaultDataDirectory => string.Equals(
        Path.GetFullPath(_dataDirectory),
        Path.GetFullPath(DefaultDataDirectory),
        StringComparison.OrdinalIgnoreCase);

    private static string DefaultDataDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "AugmentScale");

    public string SetupPath => _setupPath;
    public string SecretsPath => _secretsPath;
    public string DatabasePath => Path.Combine(_dataDirectory, "augment-scale.db");
    public string WebViewDataDirectory => Path.Combine(_dataDirectory, "WebView2");
    public string LogDirectory => Path.Combine(_dataDirectory, "logs");

    public SetupConfig Setup
    {
        get
        {
            lock (_gate)
            {
                return _setup ??= LoadOrCreateSetup();
            }
        }
    }

    public AppSecrets Secrets
    {
        get
        {
            lock (_gate)
            {
                return _secrets ??= LoadOrCreateSecrets();
            }
        }
    }

    public string DatabaseKey => Secrets.DatabaseKey;

    public void EnsureInitialized()
    {
        _ = Setup;
        _ = Secrets;
        Directory.CreateDirectory(LogDirectory);
        Directory.CreateDirectory(WebViewDataDirectory);
    }

    public bool AuthenticatePin(string profileId, string pin)
    {
        if (string.IsNullOrWhiteSpace(profileId) || string.IsNullOrEmpty(pin)) return false;
        if (!Secrets.PinHashes.TryGetValue(profileId, out var stored)) return false;
        return VerifyPin(pin, stored);
    }

    public bool HasPin(string profileId) =>
        Secrets.PinHashes.ContainsKey(profileId);

    public void SetPin(string profileId, string pin)
    {
        if (string.IsNullOrWhiteSpace(profileId))
            throw new ArgumentException("Profile is required.", nameof(profileId));
        if (pin.Length is < 4 or > 8 || !pin.All(char.IsAsciiDigit))
            throw new InvalidOperationException("PIN must be 4 to 8 digits.");

        lock (_gate)
        {
            var secrets = LoadOrCreateSecrets();
            secrets.PinHashes[profileId] = HashPin(pin);
            SaveSecrets(secrets);
        }
    }

    public static string HashPin(string pin)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(pin),
            salt,
            Iterations,
            HashAlgorithmName.SHA256,
            HashLength);
        return $"{Convert.ToBase64String(salt)}:{Convert.ToBase64String(hash)}";
    }

    public static bool VerifyPin(string pin, string stored)
    {
        try
        {
            var parts = stored.Split(':', 2);
            if (parts.Length != 2) return false;
            var salt = Convert.FromBase64String(parts[0]);
            var expected = Convert.FromBase64String(parts[1]);
            var actual = Rfc2898DeriveBytes.Pbkdf2(
                Encoding.UTF8.GetBytes(pin),
                salt,
                Iterations,
                HashAlgorithmName.SHA256,
                expected.Length);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private SetupConfig LoadOrCreateSetup()
    {
        if (!File.Exists(_setupPath))
        {
            var template = Path.Combine(AppContext.BaseDirectory, "Resources", "setup.json");
            if (File.Exists(template))
            {
                File.Copy(template, _setupPath, overwrite: false);
            }
            else
            {
                var fresh = new SetupConfig();
                File.WriteAllText(_setupPath, JsonSerializer.Serialize(fresh, _json), Encoding.UTF8);
            }
        }

        var json = File.ReadAllText(_setupPath, Encoding.UTF8);
        var setup = JsonSerializer.Deserialize<SetupConfig>(json, _json)
                    ?? throw new InvalidOperationException("setup.json is empty or invalid.");
        return setup;
    }

    private AppSecrets LoadOrCreateSecrets()
    {
        if (File.Exists(_secretsPath))
        {
            try
            {
                var protectedBytes = File.ReadAllBytes(_secretsPath);
                var plain = ProtectedData.Unprotect(protectedBytes, Entropy, DataProtectionScope.CurrentUser);
                var existing = JsonSerializer.Deserialize<AppSecrets>(plain, _json);
                if (existing is not null && !string.IsNullOrWhiteSpace(existing.DatabaseKey))
                {
                    var changed = ProvisionMissingPins(existing);
                    if (changed) SaveSecrets(existing);
                    return existing;
                }
            }
            catch (CryptographicException)
            {
                // Corrupt or foreign-user secrets file: provision a fresh set.
            }
            catch (JsonException)
            {
                // Fall through and regenerate.
            }
        }

        var secrets = new AppSecrets
        {
            DatabaseKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        };
        ProvisionMissingPins(secrets);
        SaveSecrets(secrets);
        return secrets;
    }

    /// <summary>
    /// Hashes any configured bootstrap PIN and then removes it from setup.json.
    /// </summary>
    private bool ProvisionMissingPins(AppSecrets secrets)
    {
        var setup = _setup ?? LoadOrCreateSetup();
        var changed = false;
        foreach (var op in setup.Operators)
        {
            if (string.IsNullOrWhiteSpace(op.Id)) op.Id = op.Code.ToLowerInvariant();
            if (!string.IsNullOrEmpty(op.Pin) && !secrets.PinHashes.ContainsKey(op.Id))
            {
                secrets.PinHashes[op.Id] = HashPin(op.Pin);
                changed = true;
            }

            if (!string.IsNullOrEmpty(op.Pin))
            {
                op.Pin = string.Empty;
                changed = true;
            }
        }

        if (changed)
        {
            _setup = setup;
            File.WriteAllText(_setupPath, JsonSerializer.Serialize(setup, _json), Encoding.UTF8);
        }

        return changed;
    }

    private void SaveSecrets(AppSecrets secrets)
    {
        var plain = JsonSerializer.SerializeToUtf8Bytes(secrets, _json);
        var protectedBytes = ProtectedData.Protect(plain, Entropy, DataProtectionScope.CurrentUser);
        var temp = _secretsPath + ".tmp";
        File.WriteAllBytes(temp, protectedBytes);
        File.Move(temp, _secretsPath, overwrite: true);
        _secrets = secrets;
    }
}
