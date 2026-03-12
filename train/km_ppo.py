"""
PPO training for Korean Mahjong AI using MaskablePPO (sb3-contrib).

Usage:
  # Start new run
  nohup train/venv/bin/python3 train/km_ppo.py > train/km-ppo.log 2>&1 &

  # Resume from checkpoint
  nohup train/venv/bin/python3 train/km_ppo.py --resume > train/km-ppo.log 2>&1 &
"""
import sys, os, argparse, time
sys.path.insert(0, os.path.dirname(__file__))

import numpy as np
import torch
from stable_baselines3.common.vec_env import SubprocVecEnv, VecMonitor
from stable_baselines3.common.callbacks import BaseCallback
from sb3_contrib import MaskablePPO
from sb3_contrib.common.wrappers import ActionMasker
from sb3_contrib.common.maskable.evaluation import evaluate_policy

from km_gym import KoreanMahjongEnv

# ============================================================
# CONFIG
# ============================================================
N_ENVS        = 8          # parallel envs
TOTAL_STEPS   = 10_000_000
N_STEPS       = 2048       # steps per env per update
BATCH_SIZE    = 512
N_EPOCHS      = 10
LR            = 3e-4
GAMMA         = 0.99
CLIP_RANGE    = 0.2
ENT_COEF      = 0.01       # entropy bonus (encourages exploration)

SAVE_DIR      = os.path.join(os.path.dirname(__file__), 'ppo_checkpoints')
BEST_PATH     = os.path.join(os.path.dirname(__file__), 'km_ppo_best')
LOG_PATH      = os.path.join(os.path.dirname(__file__), 'ppo_logs')
EVAL_FREQ     = 100_000    # steps between evaluations
EVAL_EPISODES = 500

POLICY_KWARGS = dict(
    net_arch=[256, 256, 256],  # 3 hidden layers of 256
    activation_fn=torch.nn.ReLU,
)

# ============================================================
# HELPERS
# ============================================================

def make_env(seed=0):
    def _init():
        env = KoreanMahjongEnv()
        env = ActionMasker(env, lambda e: e.action_masks())
        return env
    return _init


class EvalAndSaveCallback(BaseCallback):
    """Evaluate against random baseline and save best model."""

    def __init__(self, eval_freq: int, eval_episodes: int, save_path: str, verbose: int = 1):
        super().__init__(verbose)
        self.eval_freq = eval_freq
        self.eval_episodes = eval_episodes
        self.save_path = save_path
        self.best_mean_reward = -np.inf
        self._last_eval = 0

    def _on_step(self) -> bool:
        if self.num_timesteps - self._last_eval < self.eval_freq:
            return True
        self._last_eval = self.num_timesteps

        # Evaluate with greedy policy (deterministic=True)
        eval_env = ActionMasker(KoreanMahjongEnv(), lambda e: e.action_masks())
        mean_reward, std_reward = evaluate_policy(
            self.model, eval_env, n_eval_episodes=self.eval_episodes,
            deterministic=True, warn=False
        )
        eval_env.close()

        if self.verbose:
            print(f"\n[{self.num_timesteps:,}] eval: mean={mean_reward:.4f} ± {std_reward:.4f}", flush=True)

        if mean_reward > self.best_mean_reward:
            self.best_mean_reward = mean_reward
            self.model.save(self.save_path)
            if self.verbose:
                print(f"  *** NEW BEST ({mean_reward:.4f}) — saved to {self.save_path} ***", flush=True)

        return True


# ============================================================
# MAIN
# ============================================================

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--resume', action='store_true', help='Resume from best checkpoint')
    args = parser.parse_args()

    os.makedirs(SAVE_DIR, exist_ok=True)
    os.makedirs(LOG_PATH, exist_ok=True)

    print("=== Korean Mahjong PPO Training ===")
    print(f"Envs: {N_ENVS}, Steps: {TOTAL_STEPS:,}, LR: {LR}")
    print(f"Net: {POLICY_KWARGS['net_arch']}, Batch: {BATCH_SIZE}, Epochs: {N_EPOCHS}")
    print(flush=True)

    # Vectorized envs
    env = SubprocVecEnv([make_env(i) for i in range(N_ENVS)])
    env = VecMonitor(env)

    if args.resume and os.path.exists(BEST_PATH + '.zip'):
        print(f"Resuming from {BEST_PATH}.zip ...", flush=True)
        model = MaskablePPO.load(BEST_PATH, env=env)
        model.learning_rate = LR  # keep LR consistent
    else:
        print("Starting new training run...", flush=True)
        model = MaskablePPO(
            'MlpPolicy',
            env,
            n_steps=N_STEPS,
            batch_size=BATCH_SIZE,
            n_epochs=N_EPOCHS,
            learning_rate=LR,
            gamma=GAMMA,
            clip_range=CLIP_RANGE,
            ent_coef=ENT_COEF,
            policy_kwargs=POLICY_KWARGS,
            tensorboard_log=None,
            verbose=1,
        )

    callback = EvalAndSaveCallback(
        eval_freq=EVAL_FREQ,
        eval_episodes=EVAL_EPISODES,
        save_path=BEST_PATH,
        verbose=1,
    )

    t0 = time.time()
    model.learn(
        total_timesteps=TOTAL_STEPS,
        callback=callback,
        reset_num_timesteps=not args.resume,
        progress_bar=False,
    )
    elapsed = time.time() - t0
    print(f"\nTraining complete in {elapsed/3600:.1f}h", flush=True)
    model.save(os.path.join(SAVE_DIR, 'km_ppo_final'))
    env.close()


if __name__ == '__main__':
    main()
