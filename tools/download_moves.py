"""CLI entry point for the tai chi reference library.

See docs/superpowers/specs/2026-04-21-tai-chi-reference-library-design.md
"""
import sys
from tools.move_library import parse_args, main


if __name__ == "__main__":
    sys.exit(main(parse_args(sys.argv[1:])))
