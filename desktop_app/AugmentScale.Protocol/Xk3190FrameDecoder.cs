using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace AugmentScale.Protocol;

/// <summary>
/// Decodes the XK3190-D10 continuous stream. Byte-for-byte port of the
/// verified Python implementation (xk3190_console_test.py).
/// </summary>
public static partial class Xk3190FrameDecoder
{
    public const byte STX = 0x02;
    public const byte ETX = 0x03;

    [GeneratedRegex(@"\d+(?:\.\d+)?", RegexOptions.CultureInvariant)]
    private static partial Regex NumberPattern();

    public static string HexDump(ReadOnlySpan<byte> data)
    {
        if (data.Length == 0) return string.Empty;
        var sb = new StringBuilder(data.Length * 3);
        for (var i = 0; i < data.Length; i++)
        {
            if (i > 0) sb.Append(' ');
            sb.Append(data[i].ToString("X2", CultureInfo.InvariantCulture));
        }
        return sb.ToString();
    }

    public static byte[] ComputeChecksum(ReadOnlySpan<byte> payload)
    {
        byte x = 0;
        foreach (var b in payload) x ^= b;
        return
        [
            (byte)((x <= 9 ? 0x30 : 0x37) + (x >> 4)),
            (byte)((x <= 9 ? 0x30 : 0x37) + (x & 0x0F))
        ];
    }

    /// <summary>
    /// Decodes a complete frame. Returns null when the frame is not a
    /// recognisable Yaohua frame.
    /// </summary>
    public static DecodedFrame? Decode(ReadOnlySpan<byte> frame)
    {
        // Yaohua continuous format 1: 12 bytes with checksum.
        if (frame.Length == 12 && frame[0] == STX && frame[11] == ETX &&
            (frame[1] == 0x2B || frame[1] == 0x2D))
        {
            var digits = frame.Slice(2, 6);
            var decByte = frame[8];
            var allDigits = true;
            foreach (var d in digits)
            {
                if (d is < 0x30 or > 0x39)
                {
                    allDigits = false;
                    break;
                }
            }

            if (allDigits && decByte is >= 0x30 and <= 0x34)
            {
                var dec = decByte - 0x30;
                var expected = ComputeChecksum(frame.Slice(1, 8));
                var actual = frame.Slice(9, 2).ToArray();
                var valid = expected.AsSpan().SequenceEqual(actual);
                var digitsText = Encoding.ASCII.GetString(digits);
                var digitsValue = int.Parse(digitsText, CultureInfo.InvariantCulture);
                var value = digitsValue / Math.Pow(10, dec);
                var negative = frame[1] == 0x2D;
                if (negative) value = -value;

                return new DecodedFrame
                {
                    Value = value,
                    DecimalCount = dec,
                    Sign = negative ? "-" : "+",
                    ChecksumValid = valid,
                    ChecksumExpected = Hex( expected),
                    ChecksumActual = Hex(actual),
                    Kind = "format1",
                    RawDigits = digitsText,
                    RawFrame = frame.ToArray(),
                    RawFrameHex = HexDump(frame),
                };
            }
        }

        // Other Yaohua continuous formats (frames starting with '=' or '@').
        if (frame.Length > 0 && (frame[0] == (byte)'=' || frame[0] == (byte)'@'))
        {
            string text;
            try
            {
                text = Encoding.ASCII.GetString(frame);
            }
            catch (DecoderFallbackException)
            {
                return null;
            }

            var match = NumberPattern().Match(text);
            if (match.Success)
            {
                var token = match.Value;
                var trimmed = text.TrimEnd('\r', '\n', '\0');
                var negative = trimmed.EndsWith('-') ||
                               (text.Length > 1 && text[..2].Contains('-'));
                var value = double.Parse(
                    (negative ? "-" : string.Empty) + token,
                    CultureInfo.InvariantCulture);
                var dec = token.Contains('.') ? token.Split('.')[1].Length : 0;

                return new DecodedFrame
                {
                    Value = value,
                    DecimalCount = dec,
                    Sign = negative ? "-" : "+",
                    ChecksumValid = null,
                    ChecksumExpected = null,
                    ChecksumActual = null,
                    Kind = "other-format",
                    RawDigits = token.Replace(".", string.Empty, StringComparison.Ordinal),
                    RawFrame = frame.ToArray(),
                    RawFrameHex = HexDump(frame),
                };
            }
        }

        return null;
    }

    private static string Hex(ReadOnlySpan<byte> bytes)
    {
        var chars = new char[bytes.Length * 2];
        for (var i = 0; i < bytes.Length; i++)
        {
            var hi = bytes[i] >> 4;
            var lo = bytes[i] & 0x0F;
            chars[i * 2] = (char)(hi <= 9 ? '0' + hi : 'A' + hi - 10);
            chars[i * 2 + 1] = (char)(lo <= 9 ? '0' + lo : 'A' + lo - 10);
        }
        return new string(chars);
    }
}

public sealed class DecodedFrame
{
    public double Value { get; init; }
    public string RawDigits { get; init; } = string.Empty;
    public string Sign { get; init; } = "+";
    public int DecimalCount { get; init; }
    public bool? ChecksumValid { get; init; }
    public string? ChecksumExpected { get; init; }
    public string? ChecksumActual { get; init; }
    public string Kind { get; init; } = "format1";
    public byte[] RawFrame { get; init; } = [];
    public string RawFrameHex { get; init; } = string.Empty;
}
