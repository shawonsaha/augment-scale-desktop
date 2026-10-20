using System.Globalization;
using System.Text;

namespace AugmentScale.Protocol;

public static class Xk3190FrameEncoder
{
    public const int MaxDigits = 999999;

    public static byte[] Build(double valueKg, int decimals = 0, bool corruptChecksum = false)
    {
        if (decimals is < 0 or > 4)
            throw new ArgumentOutOfRangeException(nameof(decimals), "Decimals must be 0 to 4.");

        var scaled = (long)Math.Round(
            Math.Abs(valueKg) * Math.Pow(10, decimals),
            MidpointRounding.AwayFromZero);
        scaled = Math.Clamp(scaled, 0, MaxDigits);

        var payload = new byte[8];
        payload[0] = valueKg < 0 ? (byte)'-' : (byte)'+';
        Encoding.ASCII.GetBytes(scaled.ToString("D6", CultureInfo.InvariantCulture))
            .CopyTo(payload, 1);
        payload[7] = (byte)('0' + decimals);

        var checksum = Xk3190FrameDecoder.ComputeChecksum(payload);
        if (corruptChecksum)
            checksum[1] = checksum[1] == (byte)'0' ? (byte)'1' : (byte)'0';

        var frame = new byte[12];
        frame[0] = Xk3190FrameDecoder.STX;
        payload.CopyTo(frame, 1);
        checksum.CopyTo(frame, 9);
        frame[11] = Xk3190FrameDecoder.ETX;
        return frame;
    }
}
