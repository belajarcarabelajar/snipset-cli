{
  description = "Snipset CLI, the terminal companion for the Snipset snippet manager";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      pkgs = import nixpkgs {
        system = "x86_64-linux";
        config.allowUnfree = true;
      };
      snipset = pkgs.stdenv.mkDerivation {
        pname = "snipset-cli";
        version = "0.2.0";
        src = pkgs.fetchurl {
          url = "https://github.com/belajarcarabelajar/snipset-cli/releases/download/v0.2.0/snipset-cli-v0.2.0-x86_64-unknown-linux-gnu.tar.gz";
          hash = "sha256-V7Q7buC1X8aQysiFHSxQCe79wQ5Tj7VoO8KUz4x4z+U=";
        };
        # The tarball holds the binary at its root and one directory, shell/, which unpack would enter.
        sourceRoot = ".";
        nativeBuildInputs = [ pkgs.autoPatchelfHook pkgs.installShellFiles ];
        buildInputs = [ pkgs.openssl pkgs.zlib pkgs.brotli pkgs.zstd pkgs.stdenv.cc.cc.lib ];
        installPhase = ''
          runHook preInstall
          install -Dm755 snipset $out/bin/snipset
          install -Dm755 shell/snipset-shims.sh $out/bin/snipset-shims
          installShellCompletion --bash --name snipset.bash shell/completion.bash
          runHook postInstall
        '';
        meta = {
          license = pkgs.lib.licenses.unfree;
          sourceProvenance = [ pkgs.lib.sourceTypes.binaryNativeCode ];
          platforms = [ "x86_64-linux" ];
          mainProgram = "snipset";
        };
      };
    in
    {
      packages.x86_64-linux.default = snipset;
      apps.x86_64-linux.default = {
        type = "app";
        program = "${snipset}/bin/snipset";
      };
    };
}
