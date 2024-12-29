{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let pkgs = nixpkgs.legacyPackages.x86_64-linux;
    in {
      formatter.x86_64-linux = pkgs.nixfmt-classic;

      packages.x86_64-linux.default = pkgs.rustPlatform.buildRustPackage {
        name = "einkaufszettel";
        src = ./.;
        cargoHash = "sha256-8QPwt2FTXV6H692RFQjrJp3BHi8JxIEpFDDv3wR60ZY=";
      };

      devShells.x86_64-linux.default =
        self.packages.x86_64-linux.default.overrideAttrs (attrs: {
          nativeBuildInputs = attrs.nativeBuildInputs ++ (with pkgs; [ rustfmt clippy rust-analyzer watchexec ]);
          RUST_SRC_PATH = "${pkgs.rust.packages.stable.rustPlatform.rustLibSrc}";
          RUST_BACKTRACE = 1;
        });
    };
}
