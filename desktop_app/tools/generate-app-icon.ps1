# Generates the multi-resolution Augment Scale vehicle weighbridge application icon
param(
    [string]$OutputPath = "$PSScriptRoot\..\AugmentScale\Resources\app.ico"
)

Add-Type -AssemblyName PresentationCore, PresentationFramework, WindowsBase, System.Drawing

function Render-Frame([int]$size) {
    $visual = [System.Windows.Media.DrawingVisual]::new()
    $dc = $visual.RenderOpen()

    $radius = [Math]::Max(2.0, $size * 0.22)
    $rect = [System.Windows.Rect]::new(0, 0, $size, $size)

    # Dark gradient background (#131E33 -> #070B14)
    $grad = [System.Windows.Media.LinearGradientBrush]::new(
        [System.Windows.Media.Color]::FromRgb(0x13, 0x1E, 0x33),
        [System.Windows.Media.Color]::FromRgb(0x07, 0x0B, 0x14),
        [System.Windows.Point]::new(0, 0),
        [System.Windows.Point]::new(0, 1)
    )
    $borderThickness = [Math]::Max(1.0, $size * 0.035)
    $borderPen = [System.Windows.Media.Pen]::new(
        [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromArgb(0x55, 0x2D, 0xD4, 0xBF)),
        $borderThickness
    )
    $dc.DrawRoundedRectangle($grad, $borderPen, $rect, $radius, $radius)

    # Scale coordinate space from 32x32 design canvas
    $scale = $size / 32.0
    $dc.PushTransform([System.Windows.Media.ScaleTransform]::new($scale, $scale))

    $tealColor = [System.Windows.Media.Color]::FromRgb(0x2D, 0xD4, 0xBF)
    $tealBrush = [System.Windows.Media.SolidColorBrush]::new($tealColor)
    $fillBrush = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromArgb(0x35, 0x2D, 0xD4, 0xBF))

    $mainStrokeWidth = if ($size -le 16) { 2.2 } elseif ($size -le 32) { 2.0 } else { 1.8 }
    $mainPen = [System.Windows.Media.Pen]::new($tealBrush, $mainStrokeWidth)
    $mainPen.StartLineCap = [System.Windows.Media.PenLineCap]::Round
    $mainPen.EndLineCap = [System.Windows.Media.PenLineCap]::Round
    $mainPen.LineJoin = [System.Windows.Media.PenLineJoin]::Round

    # 1. Cargo Container Box
    $cargoGeo = [System.Windows.Media.Geometry]::Parse("M 4,8 L 18,8 L 18,17 L 4,17 Z")
    $dc.DrawGeometry($fillBrush, $mainPen, $cargoGeo)

    # 2. Truck Cab
    $cabGeo = [System.Windows.Media.Geometry]::Parse("M 18,11 L 23,11 L 26.5,14 L 26.5,17 L 18,17 Z")
    $dc.DrawGeometry($fillBrush, $mainPen, $cabGeo)

    # 3. Cab Window
    if ($size -ge 24) {
        $winPen = [System.Windows.Media.Pen]::new($tealBrush, 1.2)
        $winGeo = [System.Windows.Media.Geometry]::Parse("M 19.5,12.2 L 22.5,12.2 L 24.5,14.2 L 19.5,14.2 Z")
        $dc.DrawGeometry([System.Windows.Media.Brushes]::Transparent, $winPen, $winGeo)
    }

    # 4. Wheels
    $wheelPenWidth = if ($size -le 16) { 1.8 } else { 1.5 }
    $wheelPen = [System.Windows.Media.Pen]::new($tealBrush, $wheelPenWidth)
    $wheelFill = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(0x07, 0x0B, 0x14))
    $dc.DrawEllipse($wheelFill, $wheelPen, [System.Windows.Point]::new(7.5, 17.5), 1.8, 1.8)
    $dc.DrawEllipse($wheelFill, $wheelPen, [System.Windows.Point]::new(12.5, 17.5), 1.8, 1.8)
    $dc.DrawEllipse($wheelFill, $wheelPen, [System.Windows.Point]::new(23.5, 17.5), 1.8, 1.8)

    # 5. Weighbridge Platform Deck
    $deckStrokeWidth = if ($size -le 16) { 2.6 } else { 2.2 }
    $deckPen = [System.Windows.Media.Pen]::new($tealBrush, $deckStrokeWidth)
    $deckPen.StartLineCap = [System.Windows.Media.PenLineCap]::Round
    $deckPen.EndLineCap = [System.Windows.Media.PenLineCap]::Round
    $dc.DrawLine($deckPen, [System.Windows.Point]::new(2.5, 20.5), [System.Windows.Point]::new(29.5, 20.5))

    # Entry/Exit ramps
    $rampPen = [System.Windows.Media.Pen]::new($tealBrush, [Math]::Max(1.2, $mainStrokeWidth - 0.4))
    $dc.DrawLine($rampPen, [System.Windows.Point]::new(1.0, 22.5), [System.Windows.Point]::new(3.5, 20.5))
    $dc.DrawLine($rampPen, [System.Windows.Point]::new(28.5, 20.5), [System.Windows.Point]::new(31.0, 22.5))

    # 6. Load Cell Foundation Sensors
    $cellPen = [System.Windows.Media.Pen]::new($tealBrush, 1.4)
    $dc.DrawRectangle($fillBrush, $cellPen, [System.Windows.Rect]::new(6.0, 21.8, 3.5, 2.2))
    $dc.DrawRectangle($fillBrush, $cellPen, [System.Windows.Rect]::new(14.25, 21.8, 3.5, 2.2))
    $dc.DrawRectangle($fillBrush, $cellPen, [System.Windows.Rect]::new(22.5, 21.8, 3.5, 2.2))

    # Foundation Ground Baseline
    $basePen = [System.Windows.Media.Pen]::new(
        [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromArgb(0x88, 0x2D, 0xD4, 0xBF)),
        1.2
    )
    $dc.DrawLine($basePen, [System.Windows.Point]::new(4.5, 25.0), [System.Windows.Point]::new(27.5, 25.0))

    $dc.Pop()
    $dc.Close()

    $rtb = [System.Windows.Media.Imaging.RenderTargetBitmap]::new(
        $size, $size, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32
    )
    $rtb.Render($visual)

    $encoder = [System.Windows.Media.Imaging.PngBitmapEncoder]::new()
    $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($rtb))
    $ms = [System.IO.MemoryStream]::new()
    $encoder.Save($ms)
    $bytes = $ms.ToArray()
    $ms.Dispose()
    return $bytes
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngFrames = [System.Collections.Generic.List[byte[]]]::new()

foreach ($sz in $sizes) {
    $pngFrames.Add((Render-Frame $sz))
}

$outFullPath = [System.IO.Path]::GetFullPath($OutputPath)
$outDir = [System.IO.Path]::GetDirectoryName($outFullPath)
if (-not (Test-Path $outDir)) {
    [System.IO.Directory]::CreateDirectory($outDir) | Out-Null
}

$icoFile = [System.IO.File]::Create($outFullPath)
$writer = [System.IO.BinaryWriter]::new($icoFile)

# ICONDIR header (6 bytes)
$writer.Write([uint16]0)                # Reserved
$writer.Write([uint16]1)                # Type: 1 = ICO
$writer.Write([uint16]$sizes.Length)    # Count

# Header size: 6 + (16 * count)
$offset = 6 + ($sizes.Length * 16)

for ($i = 0; $i -lt $sizes.Length; $i++) {
    $sz = $sizes[$i]
    $data = $pngFrames[$i]

    $w = if ($sz -ge 256) { 0 } else { [byte]$sz }
    $h = if ($sz -ge 256) { 0 } else { [byte]$sz }

    # ICONDIRENTRY (16 bytes)
    $writer.Write([byte]$w)
    $writer.Write([byte]$h)
    $writer.Write([byte]0)              # Color count
    $writer.Write([byte]0)              # Reserved
    $writer.Write([uint16]1)            # Planes
    $writer.Write([uint16]32)           # Bits per pixel
    $writer.Write([uint32]$data.Length) # Image bytes
    $writer.Write([uint32]$offset)      # Offset
    $offset += $data.Length
}

for ($i = 0; $i -lt $sizes.Length; $i++) {
    $writer.Write($pngFrames[$i])
}

$writer.Flush()
$writer.Close()
$icoFile.Close()

Write-Host "Generated multi-resolution vehicle weighbridge icon at: $outFullPath ($offset bytes)"
