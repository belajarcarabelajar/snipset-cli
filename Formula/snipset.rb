class Snipset < Formula
  desc "Terminal companion for the Snipset snippet manager"
  homepage "https://github.com/belajarcarabelajar/snipset-cli"
  url "https://github.com/belajarcarabelajar/snipset-cli/releases/download/v0.3.0/snipset-cli-v0.3.0-x86_64-unknown-linux-gnu.tar.gz"
  sha256 "79a18aa09518dac05fb90cd3babe38de7b292e8f4dbd3ac6715295aa37f6fc70"
  license :cannot_represent

  livecheck do
    url :stable
    strategy :github_latest
  end

  depends_on :linux

  def install
    odie "Snipset CLI has no ARM build yet" if Hardware::CPU.arm?

    bin.install "snipset"
    bin.install "shell/snipset-shims.sh" => "snipset-shims"
    bash_completion.install "shell/completion.bash" => "snipset"
    pkgshare.install "shell/snipset.sh", "shell/tab.sh"
  end

  test do
    assert_match "snipset #{version}", shell_output("#{bin}/snipset --version")
  end
end
