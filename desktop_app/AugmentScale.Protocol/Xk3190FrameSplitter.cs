namespace AugmentScale.Protocol;

/// <summary>
/// Buffer-to-frame splitter ported from the Python implementation.
/// Handles mid-frame starts, stray ETX bytes, newline-delimited formats,
/// partial tails and a 1 KB garbage guard.
/// </summary>
public sealed class Xk3190FrameSplitter
{
    private const int GarbageGuard = 1024;
    private const int GarbageTail = 64;
    private readonly List<byte> _buffer = new(512);

    public int BufferedBytes => _buffer.Count;

    public IReadOnlyList<byte[]> Feed(ReadOnlySpan<byte> data)
    {
        var frames = new List<byte[]>();
        _buffer.AddRange(data.ToArray());
        SplitInto(frames);

        if (_buffer.Count > GarbageGuard && IndexOf(_buffer, Xk3190FrameDecoder.STX) < 0)
        {
            var tail = _buffer.GetRange(_buffer.Count - GarbageTail, GarbageTail);
            _buffer.Clear();
            _buffer.AddRange(tail);
        }

        return frames;
    }

    public void Reset() => _buffer.Clear();

    private void SplitInto(List<byte[]> frames)
    {
        while (true)
        {
            var start = IndexOf(_buffer, Xk3190FrameDecoder.STX);
            var newline = Math.Max(IndexOf(_buffer, (byte)'\r'), IndexOf(_buffer, (byte)'\n'));

            // Newline-delimited frame before the next STX.
            if (newline >= 0 && (start < 0 || newline < start))
            {
                var chunk = _buffer.GetRange(0, newline + 1);
                _buffer.RemoveRange(0, newline + 1);
                Trim(chunk);
                if (chunk.Count > 0) frames.Add(chunk.ToArray());
                continue;
            }

            if (start < 0)
            {
                if (_buffer.Count > GarbageGuard)
                {
                    var tail = _buffer.GetRange(_buffer.Count - GarbageTail, GarbageTail);
                    _buffer.Clear();
                    _buffer.AddRange(tail);
                }
                return;
            }

            if (start > 0)
            {
                _buffer.RemoveRange(0, start);
                continue;
            }

            var end = IndexOf(_buffer, Xk3190FrameDecoder.ETX, 1);
            if (end < 0)
            {
                if (_buffer.Count > GarbageGuard)
                {
                    var tail = _buffer.GetRange(_buffer.Count - GarbageTail, GarbageTail);
                    _buffer.Clear();
                    _buffer.AddRange(tail);
                }
                return;
            }

            var frame = _buffer.GetRange(0, end + 1);
            _buffer.RemoveRange(0, end + 1);
            Trim(frame);
            if (frame.Count > 0) frames.Add(frame.ToArray());
        }
    }

    private static void Trim(List<byte> bytes)
    {
        while (bytes.Count > 0)
        {
            var last = bytes[^1];
            if (last is (byte)'\r' or (byte)'\n' or 0x00) bytes.RemoveAt(bytes.Count - 1);
            else break;
        }
        while (bytes.Count > 0 && bytes[0] is (byte)'\r' or (byte)'\n' or 0x00)
        {
            bytes.RemoveAt(0);
        }
    }

    private static int IndexOf(List<byte> bytes, byte value, int from = 0)
    {
        for (var i = from; i < bytes.Count; i++)
        {
            if (bytes[i] == value) return i;
        }
        return -1;
    }
}
