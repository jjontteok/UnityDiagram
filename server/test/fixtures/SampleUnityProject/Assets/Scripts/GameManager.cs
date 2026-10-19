using UnityEngine;

/// <summary>게임 점수와 전역 상태를 관리한다.</summary>
public class GameManager : MonoBehaviour {
    public static GameManager Instance { get; private set; }
    public event System.Action<int> OnScoreChanged;
    void Awake() { Instance = this; }
    public void AddScore(int v) { OnScoreChanged?.Invoke(v); }
}
