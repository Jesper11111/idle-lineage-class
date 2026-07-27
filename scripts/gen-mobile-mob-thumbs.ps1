$ErrorActionPreference = 'Stop'

# 手機雙省電怪物辨識圖產生器。輸出刻意放在 assets/mobile-mobs：
# - 96×96 單層 PNG 封住 Safari 的 decoded-image 記憶體上限。
# - scripts/shines-backport-assets.txt 讓上游 rsync --delete 保留這個資料夾。
# - 找不到縮圖時，執行期會退 assets/mobile-mobs/_fallback.svg，不會退回原尺寸動畫幀。
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sourceRoot = Join-Path $root 'assets\anim'
$target = Join-Path $root 'assets\mobile-mobs'
New-Item -ItemType Directory -Path $target -Force | Out-Null

Add-Type -AssemblyName System.Drawing
$made = 0
foreach ($dir in Get-ChildItem -LiteralPath $sourceRoot -Directory) {
    $candidates = @(
        (Join-Path $dir.FullName 'd6\idle_0.png'),
        (Join-Path $dir.FullName 'd5\idle_0.png'),
        (Join-Path $dir.FullName 'idle_0.png'),
        (Join-Path $dir.FullName 'spawn_0.png')
    )
    $source = $candidates |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
    if (-not $source) {
        $source = Get-ChildItem -LiteralPath $dir.FullName -Recurse -File -Filter '*.png' |
            Sort-Object FullName |
            Select-Object -First 1 |
            ForEach-Object FullName
    }
    if (-not $source) { continue }

    $image = $null
    $bitmap = $null
    $graphics = $null
    try {
        $image = [System.Drawing.Image]::FromFile($source)
        $bitmap = [System.Drawing.Bitmap]::new(
            96,
            96,
            [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
        )
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

        $scale = [Math]::Min(96.0 / $image.Width, 96.0 / $image.Height)
        $width = [Math]::Max(1, [int][Math]::Round($image.Width * $scale))
        $height = [Math]::Max(1, [int][Math]::Round($image.Height * $scale))
        $x = [int][Math]::Floor((96 - $width) / 2)
        $y = [int][Math]::Floor((96 - $height) / 2)
        $graphics.DrawImage($image, $x, $y, $width, $height)

        $output = Join-Path $target ($dir.Name + '.png')
        $temp = $output + '.tmp.png'
        $bitmap.Save($temp, [System.Drawing.Imaging.ImageFormat]::Png)
        Move-Item -LiteralPath $temp -Destination $output -Force
        $made++
    } finally {
        if ($graphics) { $graphics.Dispose() }
        if ($bitmap) { $bitmap.Dispose() }
        if ($image) { $image.Dispose() }
    }
}

$files = @(Get-ChildItem -LiteralPath $target -File -Filter '*.png')
Write-Host ("[mobile-mob-thumbs] {0} 張，{1:N2} MB" -f $made, (($files | Measure-Object Length -Sum).Sum / 1MB))
