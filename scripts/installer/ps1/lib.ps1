$ErrorActionPreference = 'Stop'
# Win PS 5.1 defaults to TLS 1.0; GitHub requires TLS 1.2 since 2018-02-01.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = 'belajarcarabelajar/snipset-cli'
$baseUrl = if ($env:SNIPSET_RELEASE_BASE_URL) { $env:SNIPSET_RELEASE_BASE_URL } else { "https://github.com/$repo/releases/download" }
