# 批量将 docs-qoder-cn 下的 .txt 资料转换为纯 Markdown (.md) —— v2
# 清洗规则：
#  1) 去掉开头的 Documentation Index 引用头
#  2) MDX 容器 Warning/Note/Tip 转 Markdown 引用块（内部正确分行、去缩进）
#  3) Tabs/Tab 转标题；CodeGroup 去掉
#  4) MDX 注释 {/* */} 转 HTML 注释
#  5) 内联 <b>/<i>/<ul>/<li> 转 Markdown
#  6) 逐行 strip 标题(#)和列表项(-)的前导空格（代码围栏内除外）
#  7) 压缩多余空行

$srcDir = Join-Path $PSScriptRoot 'docs\docs-qoder-cn'

function Convert-Block([string]$inner, [string]$label) {
    # 内部按行，去每行前导空格，再以 "> " 前缀拼成引用块
    $lines = [regex]::Split($inner.Trim(), '\r?\n')
    $out = @("> **$label**")
    foreach ($ln in $lines) {
        $t = $ln.Trim()
        if ($t -eq '') { continue }
        $out += ('> ' + $t)
    }
    return ($out -join "`n")
}

function Convert-ToMarkdown([string]$text) {
    # 统一换行
    $text = $text -replace '\r\n', "`n"

    # 1) 去掉开头的 Documentation Index 引用块
    $text = $text -replace '(?s)^(?:\> [^\r\n]*\r?\n)+\r?\n', ''

    # 2) MDX 容器
    $text = $text -replace '(?s)<Warning>(.*?)</Warning>', { Convert-Block $_.Groups[1].Value '⚠️ 注意' }
    $text = $text -replace '(?s)<Note>(.*?)</Note>',       { Convert-Block $_.Groups[1].Value '📝 说明' }
    $text = $text -replace '(?s)<Tip>(.*?)</Tip>',         { Convert-Block $_.Groups[1].Value '💡 提示' }

    # 3) Tabs / Tab / CodeGroup
    $text = $text -replace '<Tabs>\s*', ''
    $text = $text -replace '\s*</Tabs>', ''
    $text = $text -replace '<Tab title="([^"]*)">', '#### $1'
    $text = $text -replace '</Tab>', ''
    $text = $text -replace '<CodeGroup>\s*', ''
    $text = $text -replace '\s*</CodeGroup>', ''

    # 4) MDX 注释 {/* */} 转 HTML 注释
    $text = $text -replace '(?s)\{\/\*\s*(.*?)\s*\*\/\}', '<!-- $1 -->'

    # 5) 内联标签：注意先处理列表 <li> 为 "- "（去缩进），再处理 <b>/<i>
    $text = $text -replace '<ul>', ''
    $text = $text -replace '</ul>', ''
    $text = $text -replace '<li>(.*?)</li>', '- $1'
    $text = $text -replace '<b>(.*?)</b>', '**$1**'
    $text = $text -replace '<i>(.*?)</i>', '*$1*'

    # 6) 逐行 strip 标题/列表项/引用内列表项/普通行 的前导空格（代码围栏内除外）
    $inFence = $false
    $result = @()
    foreach ($ln in [regex]::Split($text, '\r?\n')) {
        if ($ln -match '^\s*```') { $inFence = -not $inFence; $result += $ln; continue }
        if ($inFence) { $result += $ln; continue }
        if ($ln -match '^\s+(#{1,6}\s)')    { $result += ($ln -replace '^\s+', ''); continue }
        if ($ln -match '^\s+(-\s)')          { $result += ($ln -replace '^\s+', ''); continue }
        if ($ln -match '^\s+(\*\s)')         { $result += ($ln -replace '^\s+', ''); continue }
        if ($ln -match '^\s+([>].*)')        { $result += ($ln -replace '^\s+', ''); continue }
        if ($ln -match '^\s+(\S.*)')         { $result += ($ln -replace '^\s+', ''); continue }
        $result += $ln
    }
    $text = $result -join "`n"

    # 7) 转义裸 < 与 &（仅代码围栏外，避免误判为 HTML / 破坏代码块内的 URL）
    $inFence = $false
    $escOut = @()
    foreach ($ln in [regex]::Split($text, '\r?\n')) {
        if ($ln -match '^\s*```') { $inFence = -not $inFence; $escOut += $ln; continue }
        if ($inFence) { $escOut += $ln; continue }
        $ln = $ln -replace '<', '&lt;'
        $ln = $ln -replace '&', '&amp;'
        $escOut += $ln
    }
    $text = $escOut -join "`n"

    # 8) 压缩多余空行
    $text = [regex]::Replace($text, '(?s)(\r?\n){3,}', "`n`n")
    return $text.Trim() + "`n"
}

Get-ChildItem -Path $srcDir -Filter *.txt | ForEach-Object {
    $raw = Get-Content $_.FullName -Raw -Encoding UTF8
    $md = Convert-ToMarkdown $raw
    $outPath = Join-Path $srcDir ($_.BaseName + '.md')
    Set-Content -Path $outPath -Value $md -Encoding UTF8 -NoNewline
    Write-Host ("converted: " + $_.BaseName + '.md')
}
