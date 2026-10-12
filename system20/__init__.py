"""Isolated System 20 public interface; no other game system is imported."""

from .engine import LegalState, main_state_machine, new_state, rule_ref

__all__ = ["LegalState", "main_state_machine", "new_state", "rule_ref"]
