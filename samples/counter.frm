VERSION 5.00
Begin VB.Form Form1
   Caption         =   "Crypt Counter"
   ClientHeight    =   2400
   ClientLeft      =   60
   ClientTop       =   345
   ClientWidth     =   3600
   Begin VB.CommandButton cmdAdd
      Caption         =   "Add a soul"
      Height          =   495
      Left            =   240
      TabIndex        =   1
      Top             =   1560
      Width           =   1455
   End
   Begin VB.CommandButton cmdReset
      Caption         =   "Banish"
      Height          =   495
      Left            =   1920
      TabIndex        =   0
      Top             =   1560
      Width           =   1455
   End
   Begin VB.Label lblCount
      Alignment       =   2
      Caption         =   "0"
      Height          =   615
      Left            =   240
      Top             =   480
      Width           =   3135
   End
End
Attribute VB_Name = "Form1"
Attribute VB_Exposed = False

Dim count As Integer

Private Sub Form_Load()
   count = 0
End Sub

Private Sub cmdAdd_Click()
   count = count + 1
   lblCount.Caption = count
End Sub

Private Sub cmdReset_Click()
   count = 0
   lblCount.Caption = "0"
End Sub
