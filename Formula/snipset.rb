class Snipset < Formula
  desc "Terminal companion for the Snipset snippet manager"
  homepage "https://github.com/belajarcarabelajar/snipset-cli"
  url "https://github.com/belajarcarabelajar/snipset-cli/releases/download/v0.2.0/snipset-cli-v0.2.0-x86_64-unknown-linux-gnu.tar.gz"
  version "0.2.0"
  sha256 "57b43b6ee0b55fc690cac8851d2c5009eefdc10e538fb5683bc294cf8c78cfe5"
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
