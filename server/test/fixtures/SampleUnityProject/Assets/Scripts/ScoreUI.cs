using UnityEngine;

public class ScoreUI : MonoBehaviour {
    [SerializeField] TMPro.TMP_Text label;
    void OnEnable() { GameManager.Instance.OnScoreChanged += OnScore; }
    void OnScore(int v) { }
}
